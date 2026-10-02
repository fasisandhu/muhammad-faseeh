import type { Actor } from '../../../../shared/domain/actor.js';
import type { Subscription } from '../entities/subscription.js';

const ownsOrAdmin = (actor: Actor, subscription: Subscription): boolean =>
  subscription.userId === actor.userId || actor.isAdmin();

/** Domain-level authorisation for subscriptions (second enforcement layer, after the route's role guard). */
export const SubscriptionPolicy = {
  canCreate: (actor: Actor): boolean => actor.hasAnyRole(['user', 'admin']),
  canView: ownsOrAdmin,
  canManage: ownsOrAdmin,
  canListAll: (actor: Actor): boolean => actor.isAdmin(),
  canRunBilling: (actor: Actor): boolean => actor.isAdmin(),
} as const;
