import { describe, expect, it, vi } from 'vitest';
import { MonthlyUsage } from '../../../../../src/modules/chat/domain/entities/monthly-usage.js';
import { QuotaExhaustedError } from '../../../../../src/modules/chat/domain/errors.js';
import type { BundleQuotaPort } from '../../../../../src/modules/chat/domain/ports/bundle-quota-port.js';
import { QuotaAllocator } from '../../../../../src/modules/chat/domain/services/quota-allocator.js';
import { UsagePeriod } from '../../../../../src/modules/chat/domain/value-objects/usage-period.js';

const at = new Date('2026-10-15T12:00:00Z');
const october = UsagePeriod.of(at);
const bundleStart = new Date('2026-10-02T00:00:00Z');

function bundles(result: Awaited<ReturnType<BundleQuotaPort['consumeOne']>>): BundleQuotaPort {
  return {
    consumeOne: vi.fn().mockResolvedValue(result),
    refund: vi.fn().mockResolvedValue(undefined),
    summary: vi.fn().mockResolvedValue([]),
  };
}

describe('QuotaAllocator', () => {
  it('charges the free quota first and does not touch bundles', async () => {
    const port = bundles({ kind: 'charged', subscriptionId: 's-1', bundlePeriodStart: bundleStart });
    const usage = MonthlyUsage.start('u-1', october);
    const charge = await new QuotaAllocator(3).allocate(usage, port, at);
    expect(charge).toEqual({ kind: 'FREE', period: october });
    expect(usage.freeUsed).toBe(1);
    expect(port.consumeOne).not.toHaveBeenCalled();
  });

  it('charges a bundle once the free quota is used', async () => {
    const port = bundles({ kind: 'charged', subscriptionId: 's-1', bundlePeriodStart: bundleStart });
    const usage = MonthlyUsage.rehydrate({
      userId: 'u-1',
      period: october,
      freeUsed: 3,
      paidUsed: 0,
      totalTokens: 0,
    });
    const charge = await new QuotaAllocator(3).allocate(usage, port, at);
    expect(charge).toEqual({
      kind: 'BUNDLE',
      period: october,
      subscriptionId: 's-1',
      bundlePeriodStart: bundleStart,
    });
    expect(usage.paidUsed).toBe(1);
    expect(port.consumeOne).toHaveBeenCalledWith('u-1', at);
  });

  it('throws a typed quota error with reset date and bundle counts', async () => {
    const port = bundles({ kind: 'none', activeBundles: 2 });
    const usage = MonthlyUsage.rehydrate({
      userId: 'u-1',
      period: october,
      freeUsed: 3,
      paidUsed: 7,
      totalTokens: 0,
    });
    const error = await new QuotaAllocator(3).allocate(usage, port, at).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as QuotaExhaustedError).details).toEqual({
      period: '2026-10',
      free: { limit: 3, used: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
      bundles: { active: 2, withRemaining: 0 },
    });
    expect(usage.paidUsed).toBe(7);
  });

  it('honours a configured free limit of zero', async () => {
    const port = bundles({ kind: 'none', activeBundles: 0 });
    await expect(
      new QuotaAllocator(0).allocate(MonthlyUsage.start('u-1', october), port, at),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(port.consumeOne).toHaveBeenCalledOnce();
  });
});
