import type { UsagePeriod } from './usage-period.js';

/** What a message was charged to. Stored with the message so a refund always reverses the exact charge. */
export type QuotaCharge =
  | { readonly kind: 'FREE'; readonly period: UsagePeriod }
  | {
      readonly kind: 'BUNDLE';
      readonly period: UsagePeriod;
      readonly subscriptionId: string;
      readonly bundlePeriodStart: Date;
    };

export const freeCharge = (period: UsagePeriod): QuotaCharge => ({ kind: 'FREE', period });

export const bundleCharge = (
  period: UsagePeriod,
  subscriptionId: string,
  bundlePeriodStart: Date,
): QuotaCharge => ({
  kind: 'BUNDLE',
  period,
  subscriptionId,
  bundlePeriodStart,
});
