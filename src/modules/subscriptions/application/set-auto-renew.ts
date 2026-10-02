import type { TransactionManager } from '../../../shared/application/transaction.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { Subscription } from '../domain/entities/subscription.js';
import { SubscriptionNotFoundError } from '../domain/errors.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

export class SetAutoRenew {
  constructor(
    private readonly deps: {
      tx: TransactionManager;
      subscriptions: SubscriptionRepository;
      clock: Clock;
    },
  ) {}

  execute(input: { actor: Actor; id: string; autoRenew: boolean }): Promise<Subscription> {
    return this.deps.tx.run(async () => {
      const subscription = await this.deps.subscriptions.lockById(input.id);
      if (!subscription || !SubscriptionPolicy.canManage(input.actor, subscription)) {
        throw new SubscriptionNotFoundError(input.id);
      }
      subscription.setAutoRenew(input.autoRenew, this.deps.clock.now());
      await this.deps.subscriptions.save(subscription);
      return subscription;
    });
  }
}
