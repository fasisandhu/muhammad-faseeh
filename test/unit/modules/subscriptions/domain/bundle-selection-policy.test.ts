import { describe, expect, it } from 'vitest';
import {
  Subscription,
  type SubscriptionProps,
} from '../../../../../src/modules/subscriptions/domain/entities/subscription.js';
import { BundleSelectionPolicy } from '../../../../../src/modules/subscriptions/domain/policies/bundle-selection-policy.js';

const now = new Date('2026-10-15T12:00:00.000Z');

function bundle(overrides: Partial<SubscriptionProps>): Subscription {
  return Subscription.rehydrate({
    id: 's-x',
    userId: 'u-1',
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    maxMessages: 10,
    usedMessages: 0,
    price: { amountCents: 999, currency: 'USD' },
    status: 'ACTIVE',
    inactiveReason: null,
    autoRenew: true,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-11-01T00:00:00.000Z'),
    renewalDate: new Date('2026-11-01T00:00:00.000Z'),
    renewalCount: 0,
    cancelledAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('BundleSelectionPolicy (latest remaining quota first)', () => {
  it('picks the most recently started bundle with messages left', () => {
    const older = bundle({ id: 'older', startDate: new Date('2026-10-01T00:00:00Z') });
    const newer = bundle({ id: 'newer', startDate: new Date('2026-10-10T00:00:00Z') });
    expect(BundleSelectionPolicy.select([older, newer], now)?.id).toBe('newer');
  });

  it('skips exhausted, inactive and out-of-period bundles', () => {
    const exhausted = bundle({
      id: 'exhausted',
      startDate: new Date('2026-10-12T00:00:00Z'),
      usedMessages: 10,
    });
    const cancelled = bundle({
      id: 'cancelled',
      startDate: new Date('2026-10-11T00:00:00Z'),
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
    });
    const ended = bundle({
      id: 'ended',
      startDate: new Date('2026-10-10T00:00:00Z'),
      endDate: new Date('2026-10-14T00:00:00Z'),
    });
    const usable = bundle({ id: 'usable', startDate: new Date('2026-10-01T00:00:00Z'), usedMessages: 9 });
    expect(BundleSelectionPolicy.select([exhausted, cancelled, ended, usable], now)?.id).toBe('usable');
  });

  it('treats unlimited bundles as always having messages left', () => {
    const enterprise = bundle({
      id: 'ent',
      tier: 'ENTERPRISE',
      maxMessages: null,
      usedMessages: 9999,
      startDate: new Date('2026-10-05T00:00:00Z'),
    });
    expect(BundleSelectionPolicy.select([enterprise], now)?.id).toBe('ent');
  });

  it('breaks ties by creation time, then id', () => {
    const start = new Date('2026-10-05T00:00:00Z');
    const a = bundle({ id: 'a', startDate: start, createdAt: new Date('2026-10-05T00:00:01Z') });
    const b = bundle({ id: 'b', startDate: start, createdAt: new Date('2026-10-05T00:00:02Z') });
    const c = bundle({ id: 'c', startDate: start, createdAt: new Date('2026-10-05T00:00:02Z') });
    expect(BundleSelectionPolicy.select([a, b, c], now)?.id).toBe('c');
  });

  it('returns null when nothing is usable', () => {
    expect(BundleSelectionPolicy.select([], now)).toBeNull();
  });
});
