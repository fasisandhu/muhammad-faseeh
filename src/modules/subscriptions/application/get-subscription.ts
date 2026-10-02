import type { Actor } from '../../../shared/domain/actor.js';
import type { Subscription } from '../domain/entities/subscription.js';
import { SubscriptionNotFoundError } from '../domain/errors.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

export class GetSubscription {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async execute(input: { actor: Actor; id: string }): Promise<Subscription> {
    const subscription = await this.subscriptions.findById(input.id);
    // Not yours → 404, so ids of other users' subscriptions cannot be probed.
    if (!subscription || !SubscriptionPolicy.canView(input.actor, subscription)) {
      throw new SubscriptionNotFoundError(input.id);
    }
    return subscription;
  }
}
