import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import { Payment } from '../domain/entities/payment.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { SubscriptionDeps } from './create-subscription.js';

export interface BillingRunSummary {
  processed: number;
  renewed: number;
  paymentFailed: number;
  expired: number;
}

type Outcome = 'renewed' | 'paymentFailed' | 'expired';

/**
 * Renews or expires due subscriptions, one row per transaction. `FOR UPDATE SKIP LOCKED` lets several
 * instances (or the scheduler and an admin trigger) work in parallel on disjoint rows; the unique
 * (subscription, kind, period_start) payment key means a period is never charged twice.
 */
export class RunBillingCycle {
  constructor(private readonly deps: SubscriptionDeps & { maxPerRun: number }) {}

  async execute(actor?: Actor): Promise<BillingRunSummary> {
    if (actor && !SubscriptionPolicy.canRunBilling(actor)) throw new ForbiddenError('run billing');
    const summary: BillingRunSummary = { processed: 0, renewed: 0, paymentFailed: 0, expired: 0 };
    while (summary.processed < this.deps.maxPerRun) {
      const outcome = await this.deps.tx.run(() => this.processNext());
      if (outcome === null) break;
      summary.processed += 1;
      summary[outcome] += 1;
    }
    if (summary.processed > 0) this.deps.logger.info({ ...summary }, 'billing run completed');
    return summary;
  }

  private async processNext(): Promise<Outcome | null> {
    const now = this.deps.clock.now();
    const subscription = await this.deps.subscriptions.lockNextDue(now);
    if (!subscription) return null;

    if (subscription.isDueForExpiry(now)) {
      subscription.expire(now);
      await this.deps.subscriptions.save(subscription);
      this.deps.logger.info({ subscriptionId: subscription.id }, 'subscription expired');
      return 'expired';
    }

    const periodStart = subscription.endDate;
    const existing = await this.deps.payments.findFor(subscription.id, 'RENEWAL', periodStart);
    let succeeded: boolean;
    if (existing) {
      succeeded = existing.succeeded; // already charged for this period: apply the recorded outcome
    } else {
      const result = await this.deps.gateway.charge({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        amount: subscription.price,
        kind: 'RENEWAL',
        idempotencyKey: `${subscription.id}:${periodStart.toISOString()}`,
      });
      await this.deps.payments.insert(
        Payment.record({
          id: this.deps.ids.next(),
          subscription,
          kind: 'RENEWAL',
          periodStart,
          result,
          attemptedAt: now,
        }),
      );
      succeeded = result.status === 'SUCCEEDED';
    }
    subscription.applyRenewal(succeeded, now);
    await this.deps.subscriptions.save(subscription);
    this.deps.logger.info({ subscriptionId: subscription.id, succeeded }, 'subscription renewal processed');
    return succeeded ? 'renewed' : 'paymentFailed';
  }
}
