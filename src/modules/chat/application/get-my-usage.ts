import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { MonthlyUsage } from '../domain/entities/monthly-usage.js';
import type { BundleQuotaPort, BundleSummary } from '../domain/ports/bundle-quota-port.js';
import type { UsageRepository } from '../domain/ports/usage-repository.js';
import { UsagePeriod } from '../domain/value-objects/usage-period.js';

export interface QuotaSummary {
  period: string;
  free: { limit: number; used: number; remaining: number; resetsAt: Date };
  paidUsed: number;
  totalTokens: number;
  bundles: BundleSummary[];
}

export class GetMyUsage {
  constructor(
    private readonly deps: {
      usage: UsageRepository;
      bundles: BundleQuotaPort;
      clock: Clock;
      freeMessagesPerMonth: number;
    },
  ) {}

  async execute(actor: Actor): Promise<QuotaSummary> {
    const now = this.deps.clock.now();
    const period = UsagePeriod.of(now);
    const usage =
      (await this.deps.usage.find(actor.userId, period)) ?? MonthlyUsage.start(actor.userId, period);
    const limit = this.deps.freeMessagesPerMonth;
    return {
      period: period.value,
      free: {
        limit,
        used: usage.freeUsed,
        remaining: usage.freeRemaining(limit),
        resetsAt: period.resetsAt(),
      },
      paidUsed: usage.paidUsed,
      totalTokens: usage.totalTokens,
      bundles: await this.deps.bundles.summary(actor.userId, now),
    };
  }
}
