import { describe, expect, it } from 'vitest';
import { UsagePeriod } from '../../../../../src/modules/chat/domain/value-objects/usage-period.js';

describe('UsagePeriod', () => {
  it('uses the UTC calendar month', () => {
    expect(UsagePeriod.of(new Date('2026-10-31T23:59:59.999Z')).value).toBe('2026-10');
    expect(UsagePeriod.of(new Date('2026-11-01T00:00:00.000Z')).value).toBe('2026-11');
    // 01:00 on Nov 1 in Pakistan (UTC+5) is still October in UTC
    expect(UsagePeriod.of(new Date('2026-11-01T01:00:00+05:00')).value).toBe('2026-10');
  });

  it('starts on the 1st and resets on the 1st of the next month', () => {
    const period = UsagePeriod.parse('2026-12');
    expect(period.startsAt().toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(period.resetsAt().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('parses only YYYY-MM', () => {
    expect(UsagePeriod.parse('2026-01').equals(UsagePeriod.of(new Date('2026-01-20T00:00:00Z')))).toBe(true);
    expect(() => UsagePeriod.parse('2026-13')).toThrow();
    expect(() => UsagePeriod.parse('26-01')).toThrow();
  });
});
