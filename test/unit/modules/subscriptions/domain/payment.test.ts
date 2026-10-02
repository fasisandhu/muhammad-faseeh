import { describe, expect, it } from 'vitest';
import { Payment } from '../../../../../src/modules/subscriptions/domain/entities/payment.js';
import { Subscription } from '../../../../../src/modules/subscriptions/domain/entities/subscription.js';
import { PlanCatalog } from '../../../../../src/modules/subscriptions/domain/services/plan-catalog.js';

const now = new Date('2026-10-02T10:00:00.000Z');
const subscription = Subscription.purchase({
  id: 's-1',
  userId: 'u-1',
  plan: PlanCatalog.get('PRO', 'YEARLY'),
  autoRenew: true,
  now,
  paymentSucceeded: true,
});

describe('Payment', () => {
  it('records a successful attempt with the subscription price', () => {
    const payment = Payment.record({
      id: 'p-1',
      subscription,
      kind: 'INITIAL',
      periodStart: subscription.currentPeriodStart,
      result: { status: 'SUCCEEDED', reference: 'sim_1' },
      attemptedAt: now,
    });
    expect(payment).toMatchObject({
      id: 'p-1',
      subscriptionId: 's-1',
      userId: 'u-1',
      kind: 'INITIAL',
      periodStart: now,
      amount: { amountCents: 29990, currency: 'USD' },
      status: 'SUCCEEDED',
      providerReference: 'sim_1',
      failureReason: null,
      attemptedAt: now,
      succeeded: true,
    });
  });

  it('keeps the decline reason of a failed attempt', () => {
    const payment = Payment.record({
      id: 'p-2',
      subscription,
      kind: 'RENEWAL',
      periodStart: subscription.endDate,
      result: { status: 'FAILED', reference: 'sim_2', failureReason: 'card_declined' },
      attemptedAt: now,
    });
    expect(payment.succeeded).toBe(false);
    expect(payment.failureReason).toBe('card_declined');
  });

  it('rehydrates from storage unchanged', () => {
    const props = {
      id: 'p-3',
      subscriptionId: 's-1',
      userId: 'u-1',
      kind: 'RENEWAL' as const,
      periodStart: now,
      amount: { amountCents: 999, currency: 'USD' as const },
      status: 'SUCCEEDED' as const,
      providerReference: 'sim_3',
      failureReason: null,
      attemptedAt: now,
    };
    expect(Payment.rehydrate(props)).toMatchObject(props);
  });
});
