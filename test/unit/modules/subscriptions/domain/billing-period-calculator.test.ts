import { describe, expect, it } from 'vitest';
import {
  BillingPeriodCalculator,
  addMonthsClamped,
} from '../../../../../src/modules/subscriptions/domain/services/billing-period-calculator.js';

const iso = (date: Date) => date.toISOString();

describe('addMonthsClamped', () => {
  it('adds months and keeps the time of day', () => {
    expect(iso(addMonthsClamped(new Date('2026-10-15T09:30:00.000Z'), 1))).toBe('2026-11-15T09:30:00.000Z');
    expect(iso(addMonthsClamped(new Date('2026-12-15T00:00:00.000Z'), 1))).toBe('2027-01-15T00:00:00.000Z');
  });

  it('clamps to the last day of shorter months, including leap years', () => {
    expect(iso(addMonthsClamped(new Date('2027-01-31T00:00:00.000Z'), 1))).toBe('2027-02-28T00:00:00.000Z');
    expect(iso(addMonthsClamped(new Date('2028-01-31T00:00:00.000Z'), 1))).toBe('2028-02-29T00:00:00.000Z');
    expect(iso(addMonthsClamped(new Date('2028-02-29T00:00:00.000Z'), 12))).toBe('2029-02-28T00:00:00.000Z');
  });
});

describe('BillingPeriodCalculator.periodEnd', () => {
  it('anchors on the start date so month ends do not drift', () => {
    const start = new Date('2027-01-31T10:00:00.000Z');
    expect(iso(BillingPeriodCalculator.periodEnd(start, 'MONTHLY', 0))).toBe('2027-02-28T10:00:00.000Z');
    expect(iso(BillingPeriodCalculator.periodEnd(start, 'MONTHLY', 1))).toBe('2027-03-31T10:00:00.000Z');
  });

  it('uses twelve months for yearly cycles', () => {
    const start = new Date('2026-10-02T00:00:00.000Z');
    expect(iso(BillingPeriodCalculator.periodEnd(start, 'YEARLY', 0))).toBe('2027-10-02T00:00:00.000Z');
    expect(iso(BillingPeriodCalculator.periodEnd(start, 'YEARLY', 1))).toBe('2028-10-02T00:00:00.000Z');
  });
});
