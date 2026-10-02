import type { MonthlyUsage } from '../entities/monthly-usage.js';
import { QuotaExhaustedError } from '../errors.js';
import type { BundleQuotaPort } from '../ports/bundle-quota-port.js';
import { bundleCharge, freeCharge, type QuotaCharge } from '../value-objects/quota-charge.js';

/** Charging order: free monthly quota first, then a subscription bundle, otherwise a typed error. */
export class QuotaAllocator {
  constructor(private readonly freeMessagesPerMonth: number) {}

  async allocate(usage: MonthlyUsage, bundles: BundleQuotaPort, at: Date): Promise<QuotaCharge> {
    if (usage.hasFreeRemaining(this.freeMessagesPerMonth)) {
      usage.consumeFree(this.freeMessagesPerMonth);
      return freeCharge(usage.period);
    }
    const result = await bundles.consumeOne(usage.userId, at);
    if (result.kind === 'charged') {
      usage.recordPaid();
      return bundleCharge(usage.period, result.subscriptionId, result.bundlePeriodStart);
    }
    throw new QuotaExhaustedError({
      period: usage.period.value,
      free: {
        limit: this.freeMessagesPerMonth,
        used: usage.freeUsed,
        resetsAt: usage.period.resetsAt().toISOString(),
      },
      bundles: { active: result.activeBundles, withRemaining: 0 },
    });
  }
}
