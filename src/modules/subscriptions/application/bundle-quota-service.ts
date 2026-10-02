import type { Logger } from '../../../shared/application/logger.js';
import { BundleSelectionPolicy } from '../domain/policies/bundle-selection-policy.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

/**
 * Chat's view of bundles (structurally implements chat's BundleQuotaPort, wired in bootstrap).
 * Must run inside the caller's transaction: consumeOne/refund lock subscription rows FOR UPDATE.
 */
export class BundleQuotaService {
  constructor(private readonly deps: { subscriptions: SubscriptionRepository; logger: Logger }) {}

  async consumeOne(
    userId: string,
    at: Date,
  ): Promise<
    | { kind: 'charged'; subscriptionId: string; bundlePeriodStart: Date }
    | { kind: 'none'; activeBundles: number }
  > {
    const active = await this.deps.subscriptions.lockActiveForUser(userId, at);
    const chosen = BundleSelectionPolicy.select(active, at);
    if (!chosen) return { kind: 'none', activeBundles: active.length };
    chosen.consumeMessage(at);
    await this.deps.subscriptions.save(chosen);
    return { kind: 'charged', subscriptionId: chosen.id, bundlePeriodStart: chosen.currentPeriodStart };
  }

  async refund(charge: { subscriptionId: string; bundlePeriodStart: Date }, at: Date): Promise<void> {
    const subscription = await this.deps.subscriptions.lockById(charge.subscriptionId);
    if (subscription?.refundMessage(charge.bundlePeriodStart, at)) {
      await this.deps.subscriptions.save(subscription);
    } else {
      this.deps.logger.warn(
        { subscriptionId: charge.subscriptionId },
        'bundle refund skipped (period rolled over)',
      );
    }
  }

  async summary(
    userId: string,
    at: Date,
  ): Promise<
    { subscriptionId: string; tier: string; remainingMessages: number | null; periodEndsAt: Date }[]
  > {
    const active = await this.deps.subscriptions.findActiveForUser(userId, at);
    return active.map((s) => ({
      subscriptionId: s.id,
      tier: s.tier,
      remainingMessages: s.remainingMessages(),
      periodEndsAt: s.endDate,
    }));
  }
}
