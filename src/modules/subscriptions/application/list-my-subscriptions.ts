import type { Actor } from '../../../shared/domain/actor.js';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { Subscription, SubscriptionStatus } from '../domain/entities/subscription.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

export class ListMySubscriptions {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  execute(input: {
    actor: Actor;
    status?: SubscriptionStatus;
    page: PageRequest;
  }): Promise<Page<Subscription>> {
    return this.subscriptions.listByUser(input.actor.userId, { status: input.status }, input.page);
  }
}
