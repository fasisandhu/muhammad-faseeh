import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { Subscription, SubscriptionStatus } from '../domain/entities/subscription.js';
import { SubscriptionPolicy } from '../domain/policies/subscription-policy.js';
import type { SubscriptionRepository } from '../domain/ports/subscription-repository.js';

export class ListAllSubscriptions {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  execute(input: {
    actor: Actor;
    userId?: string;
    status?: SubscriptionStatus;
    page: PageRequest;
  }): Promise<Page<Subscription>> {
    if (!SubscriptionPolicy.canListAll(input.actor)) throw new ForbiddenError('list all subscriptions');
    return this.subscriptions.listAll({ userId: input.userId, status: input.status }, input.page);
  }
}
