import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { PaymentMetrics, PaymentRepository } from '../domain/ports/payment-repository.js';
import type { SubscriptionMetrics, SubscriptionRepository } from '../domain/ports/subscription-repository.js';

export interface SubscriptionMetricsReport {
  subscriptions: SubscriptionMetrics;
  payments: { thisMonth: PaymentMetrics };
}

export class GetSubscriptionMetrics {
  constructor(
    private readonly deps: {
      subscriptions: SubscriptionRepository;
      payments: PaymentRepository;
      clock: Clock;
    },
  ) {}

  async execute(actor: Actor): Promise<SubscriptionMetricsReport> {
    if (!SubscriptionPolicy.canListAll(actor)) throw new ForbiddenError('read subscription metrics');
    const now = this.deps.clock.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [subscriptions, thisMonth] = await Promise.all([
      this.deps.subscriptions.metrics(),
      this.deps.payments.metricsSince(monthStart),
    ]);
    return { subscriptions, payments: { thisMonth } };
  }
}
