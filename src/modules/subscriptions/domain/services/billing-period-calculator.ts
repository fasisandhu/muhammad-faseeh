import { monthsIn, type BillingCycle } from '../value-objects/tier.js';

/** Adds calendar months in UTC, clamping to the last day of the target month (Jan 31 + 1 → Feb 28/29). */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const totalMonths = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export const BillingPeriodCalculator = {
  /** End of billing period `periodIndex` (0 = first period), always computed from the original start date. */
  periodEnd(anchor: Date, cycle: BillingCycle, periodIndex: number): Date {
    return addMonthsClamped(anchor, (periodIndex + 1) * monthsIn(cycle));
  },
} as const;
