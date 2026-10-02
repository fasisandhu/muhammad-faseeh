import type { Money } from './money.js';
import type { BillingCycle, Tier } from './tier.js';

export interface Plan {
  readonly tier: Tier;
  readonly billingCycle: BillingCycle;
  /** Messages per billing cycle; null means unlimited. */
  readonly maxMessages: number | null;
  readonly price: Money;
}
