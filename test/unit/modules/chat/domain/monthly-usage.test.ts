import { describe, expect, it } from 'vitest';
import { MonthlyUsage } from '../../../../../src/modules/chat/domain/entities/monthly-usage.js';
import {
  bundleCharge,
  freeCharge,
} from '../../../../../src/modules/chat/domain/value-objects/quota-charge.js';
import { UsagePeriod } from '../../../../../src/modules/chat/domain/value-objects/usage-period.js';

const october = UsagePeriod.parse('2026-10');

describe('MonthlyUsage', () => {
  it('allows exactly the free limit', () => {
    const usage = MonthlyUsage.start('u-1', october);
    usage.consumeFree(3);
    usage.consumeFree(3);
    expect(usage.freeRemaining(3)).toBe(1);
    usage.consumeFree(3);
    expect(usage.hasFreeRemaining(3)).toBe(false);
    expect(() => {
      usage.consumeFree(3);
    }).toThrow();
    expect(usage.freeUsed).toBe(3);
  });

  it('refunds free and paid charges without going negative', () => {
    const usage = MonthlyUsage.rehydrate({
      userId: 'u-1',
      period: october,
      freeUsed: 1,
      paidUsed: 1,
      totalTokens: 0,
    });
    usage.refund(freeCharge(october));
    usage.refund(bundleCharge(october, 's-1', new Date('2026-10-01T00:00:00Z')));
    usage.refund(freeCharge(october));
    expect(usage.freeUsed).toBe(0);
    expect(usage.paidUsed).toBe(0);
  });

  it('refuses to refund a charge from another period', () => {
    const usage = MonthlyUsage.start('u-1', october);
    expect(() => {
      usage.refund(freeCharge(UsagePeriod.parse('2026-11')));
    }).toThrow();
  });

  it('accumulates tokens', () => {
    const usage = MonthlyUsage.start('u-1', october);
    usage.addTokens(40);
    usage.addTokens(2);
    expect(usage.totalTokens).toBe(42);
    expect(() => {
      usage.addTokens(-1);
    }).toThrow();
  });
});
