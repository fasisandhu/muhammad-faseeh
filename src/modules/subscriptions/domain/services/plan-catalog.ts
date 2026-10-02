import { usd } from '../value-objects/money.js';
import type { Plan } from '../value-objects/plan.js';
import { BILLING_CYCLES, TIERS, monthsIn, type BillingCycle, type Tier } from '../value-objects/tier.js';

/** Monthly allowance and price per tier. Yearly = 12× allowance at 10× price ("two months free"). */
const MONTHLY: Record<Tier, { messages: number | null; priceCents: number }> = {
  BASIC: { messages: 10, priceCents: 999 },
  PRO: { messages: 100, priceCents: 2999 },
  ENTERPRISE: { messages: null, priceCents: 9999 },
};

export const PlanCatalog = {
  get(tier: Tier, billingCycle: BillingCycle): Plan {
    const base = MONTHLY[tier];
    return {
      tier,
      billingCycle,
      maxMessages: base.messages === null ? null : base.messages * monthsIn(billingCycle),
      price: usd(billingCycle === 'MONTHLY' ? base.priceCents : base.priceCents * 10),
    };
  },
  all(): Plan[] {
    return TIERS.flatMap((tier) => BILLING_CYCLES.map((cycle) => PlanCatalog.get(tier, cycle)));
  },
} as const;
