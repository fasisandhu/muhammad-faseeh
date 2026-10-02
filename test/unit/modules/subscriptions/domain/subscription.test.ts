import { describe, expect, it } from 'vitest';
import { InvalidStateError } from '../../../../../src/shared/domain/errors.js';
import { Subscription } from '../../../../../src/modules/subscriptions/domain/entities/subscription.js';
import { SubscriptionNotActiveError } from '../../../../../src/modules/subscriptions/domain/errors.js';
import { PlanCatalog } from '../../../../../src/modules/subscriptions/domain/services/plan-catalog.js';

const now = new Date('2026-10-02T10:00:00.000Z');
const later = (iso: string) => new Date(iso);

const buy = (
  overrides: Partial<{ tier: 'BASIC' | 'PRO' | 'ENTERPRISE'; autoRenew: boolean; paid: boolean }> = {},
) =>
  Subscription.purchase({
    id: 's-1',
    userId: 'u-1',
    plan: PlanCatalog.get(overrides.tier ?? 'BASIC', 'MONTHLY'),
    autoRenew: overrides.autoRenew ?? true,
    now,
    paymentSucceeded: overrides.paid ?? true,
  });

describe('Subscription lifecycle', () => {
  it('starts an active first period when the payment succeeds', () => {
    const sub = buy();
    expect(sub.status).toBe('ACTIVE');
    expect(sub.inactiveReason).toBeNull();
    expect(sub.maxMessages).toBe(10);
    expect(sub.price).toEqual({ amountCents: 999, currency: 'USD' });
    expect(sub.startDate).toEqual(now);
    expect(sub.currentPeriodStart).toEqual(now);
    expect(sub.endDate.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(sub.renewalDate?.toISOString()).toBe('2026-11-02T10:00:00.000Z');
  });

  it('is stored inactive when the first payment fails', () => {
    const sub = buy({ paid: false });
    expect(sub.status).toBe('INACTIVE');
    expect(sub.inactiveReason).toBe('PAYMENT_FAILED');
    expect(sub.renewalDate).toBeNull();
    expect(sub.isUsableAt(now)).toBe(false);
    // The period never started: it ends where it began and nothing is set to renew.
    expect(sub.autoRenew).toBe(false);
    expect(sub.endDate).toEqual(now);
  });

  it('has no renewal date without auto-renew', () => {
    expect(buy({ autoRenew: false }).renewalDate).toBeNull();
  });

  it('consumes messages up to the allowance', () => {
    const sub = buy();
    for (let i = 0; i < 10; i += 1) sub.consumeMessage(now);
    expect(sub.remainingMessages()).toBe(0);
    expect(sub.hasRemainingMessages()).toBe(false);
    expect(() => {
      sub.consumeMessage(now);
    }).toThrow(InvalidStateError);
  });

  it('never runs out on Enterprise', () => {
    const sub = buy({ tier: 'ENTERPRISE' });
    for (let i = 0; i < 500; i += 1) sub.consumeMessage(now);
    expect(sub.remainingMessages()).toBeNull();
    expect(sub.usedMessages).toBe(500);
  });

  it('cannot be used outside its current period', () => {
    const sub = buy();
    expect(() => {
      sub.consumeMessage(later('2026-11-02T10:00:00.000Z'));
    }).toThrow(SubscriptionNotActiveError);
  });

  it('refunds only into the period that was charged', () => {
    const sub = buy();
    sub.consumeMessage(now);
    expect(sub.refundMessage(later('2026-09-02T10:00:00.000Z'), now)).toBe(false);
    expect(sub.usedMessages).toBe(1);
    expect(sub.refundMessage(now, now)).toBe(true);
    expect(sub.usedMessages).toBe(0);
    expect(sub.refundMessage(now, now)).toBe(false);
  });

  it('toggles auto-renew and the renewal date together', () => {
    const sub = buy();
    sub.setAutoRenew(false, now);
    expect(sub.autoRenew).toBe(false);
    expect(sub.renewalDate).toBeNull();
    sub.setAutoRenew(true, now);
    expect(sub.renewalDate).toEqual(sub.endDate);
  });

  it('cancels immediately, stops renewals and keeps usage', () => {
    const sub = buy();
    sub.consumeMessage(now);
    const at = later('2026-10-20T08:00:00.000Z');
    sub.cancel(at);
    expect(sub.status).toBe('INACTIVE');
    expect(sub.inactiveReason).toBe('CANCELLED');
    expect(sub.cancelledAt).toEqual(at);
    expect(sub.endDate).toEqual(at);
    expect(sub.autoRenew).toBe(false);
    expect(sub.renewalDate).toBeNull();
    expect(sub.usedMessages).toBe(1);
    expect(sub.isDueForRenewal(later('2027-01-01T00:00:00.000Z'))).toBe(false);
    expect(() => {
      sub.cancel(at);
    }).toThrow(SubscriptionNotActiveError);
    expect(() => {
      sub.setAutoRenew(true, at);
    }).toThrow(SubscriptionNotActiveError);
  });

  it('keeps the original endDate when an overdue, not yet expired subscription is cancelled', () => {
    const sub = buy();
    const periodEnd = sub.endDate;
    const afterEnd = later('2026-11-02T10:05:00.000Z');
    sub.cancel(afterEnd);
    expect(sub.status).toBe('INACTIVE');
    expect(sub.cancelledAt).toEqual(afterEnd);
    expect(sub.endDate).toEqual(periodEnd);
  });

  it('renews into the next anchored period and resets usage', () => {
    const sub = buy();
    sub.consumeMessage(now);
    const due = later('2026-11-02T10:00:00.000Z');
    expect(sub.isDueForRenewal(due)).toBe(true);
    sub.applyRenewal(true, due);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.renewalCount).toBe(1);
    expect(sub.currentPeriodStart.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(sub.endDate.toISOString()).toBe('2026-12-02T10:00:00.000Z');
    expect(sub.renewalDate).toEqual(sub.endDate);
    expect(sub.usedMessages).toBe(0);
  });

  it('becomes inactive when a renewal payment fails', () => {
    const sub = buy();
    const due = later('2026-11-02T10:00:00.000Z');
    sub.applyRenewal(false, due);
    expect(sub.status).toBe('INACTIVE');
    expect(sub.inactiveReason).toBe('PAYMENT_FAILED');
    expect(sub.renewalDate).toBeNull();
    expect(sub.autoRenew).toBe(false);
    expect(sub.endDate.toISOString()).toBe('2026-11-02T10:00:00.000Z'); // the paid period really ended here
  });

  it('refuses to renew before it is due', () => {
    expect(() => {
      buy().applyRenewal(true, now);
    }).toThrow(InvalidStateError);
  });

  it('expires at the end of the period when auto-renew is off', () => {
    const sub = buy({ autoRenew: false });
    const end = later('2026-11-02T10:00:00.000Z');
    expect(sub.isDueForExpiry(later('2026-11-02T09:59:59.999Z'))).toBe(false);
    expect(sub.isDueForExpiry(end)).toBe(true);
    sub.expire(end);
    expect(sub.status).toBe('INACTIVE');
    expect(sub.inactiveReason).toBe('EXPIRED');
  });
});
