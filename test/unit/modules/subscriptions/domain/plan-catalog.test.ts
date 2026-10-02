import { describe, expect, it } from 'vitest';
import { PlanCatalog } from '../../../../../src/modules/subscriptions/domain/services/plan-catalog.js';

describe('PlanCatalog', () => {
  it.each([
    ['BASIC', 'MONTHLY', 10, 999],
    ['BASIC', 'YEARLY', 120, 9990],
    ['PRO', 'MONTHLY', 100, 2999],
    ['PRO', 'YEARLY', 1200, 29990],
    ['ENTERPRISE', 'MONTHLY', null, 9999],
    ['ENTERPRISE', 'YEARLY', null, 99990],
  ] as const)('%s %s → %s messages for %i cents', (tier, cycle, maxMessages, cents) => {
    expect(PlanCatalog.get(tier, cycle)).toEqual({
      tier,
      billingCycle: cycle,
      maxMessages,
      price: { amountCents: cents, currency: 'USD' },
    });
  });

  it('lists all six plans', () => {
    expect(PlanCatalog.all()).toHaveLength(6);
  });
});
