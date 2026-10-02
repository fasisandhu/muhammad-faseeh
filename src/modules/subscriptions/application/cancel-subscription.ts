import type { Logger } from '../../../shared/application/logger.js';
import type { TransactionManager } from '../../../shared/application/transaction.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { Subscription } from '../domain/entities/subscription.js';
import { SubscriptionNotFoundError } from '../domain/errors.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

/** Ends the current cycle now and prevents renewals; usage, messages and payments are never deleted. */
export class CancelSubscription {
  constructor(
    private readonly deps: {
      tx: TransactionManager;
      subscriptions: SubscriptionRepository;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async execute(input: { actor: Actor; id: string }): Promise<Subscription> {
    const subscription = await this.deps.tx.run(async () => {
      const found = await this.deps.subscriptions.lockById(input.id);
      if (!found || !SubscriptionPolicy.canManage(input.actor, found)) {
        throw new SubscriptionNotFoundError(input.id);
      }
      found.cancel(this.deps.clock.now());
      await this.deps.subscriptions.save(found);
      return found;
    });
    this.deps.logger.info({ subscriptionId: subscription.id }, 'subscription cancelled');
    return subscription;
  }
}
