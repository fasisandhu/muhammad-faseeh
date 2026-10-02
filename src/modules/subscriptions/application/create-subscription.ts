import type { Logger } from '../../../shared/application/logger.js';
import type { TransactionManager } from '../../../shared/application/transaction.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/ids.js';
import { Payment } from '../domain/entities/payment.js';
import { Subscription } from '../domain/entities/subscription.js';
import { PaymentFailedError } from '../domain/errors.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { PaymentGateway } from '../domain/ports/payment-gateway.js';
import type { PaymentRepository } from '../domain/ports/payment-repository.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';
import { PlanCatalog } from '../domain/services/plan-catalog.js';
import type { BillingCycle, Tier } from '../domain/value-objects/tier.js';

export interface SubscriptionDeps {
  tx: TransactionManager;
  subscriptions: SubscriptionRepository;
  payments: PaymentRepository;
  gateway: PaymentGateway;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

/** Price, limits and dates come from the domain catalog — never from the request (mass-assignment proof). */
export class CreateSubscription {
  constructor(private readonly deps: SubscriptionDeps) {}

  async execute(input: {
    actor: Actor;
    tier: Tier;
    billingCycle: BillingCycle;
    autoRenew: boolean;
  }): Promise<Subscription> {
    if (!SubscriptionPolicy.canCreate(input.actor)) throw new ForbiddenError('create subscriptions');
    const plan = PlanCatalog.get(input.tier, input.billingCycle);
    const id = this.deps.ids.next();
    const now = this.deps.clock.now();
    const result = await this.deps.gateway.charge({
      subscriptionId: id,
      userId: input.actor.userId,
      amount: plan.price,
      kind: 'INITIAL',
      idempotencyKey: `${id}:initial`,
    });
    const subscription = Subscription.purchase({
      id,
      userId: input.actor.userId,
      plan,
      autoRenew: input.autoRenew,
      now,
      paymentSucceeded: result.status === 'SUCCEEDED',
    });
    await this.deps.tx.run(async () => {
      await this.deps.subscriptions.insert(subscription);
      await this.deps.payments.insert(
        Payment.record({
          id: this.deps.ids.next(),
          subscription,
          kind: 'INITIAL',
          periodStart: subscription.currentPeriodStart,
          result,
          attemptedAt: now,
        }),
      );
    });
    this.deps.logger.info(
      { subscriptionId: id, tier: plan.tier, billingCycle: plan.billingCycle, payment: result.status },
      'subscription purchased',
    );
    if (result.status === 'FAILED') throw new PaymentFailedError(id, result.failureReason);
    return subscription;
  }
}
