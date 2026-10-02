export const TIERS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export type Tier = (typeof TIERS)[number];

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const monthsIn = (cycle: BillingCycle): number => (cycle === 'MONTHLY' ? 1 : 12);
