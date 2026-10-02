import type { Page, PageRequest } from '../../../../shared/domain/pagination.js';
import type { InactiveReason, Subscription, SubscriptionStatus } from '../entities/subscription.js';
import type { BillingCycle, Tier } from '../value-objects/tier.js';

export interface SubscriptionMetrics {
  activeByTier: Record<Tier, number>;
  activeByCycle: Record<BillingCycle, number>;
  autoRenewEnabled: number;
  inactiveByReason: Record<InactiveReason, number>;
}

export interface SubscriptionRepository {
  insert(subscription: Subscription): Promise<void>;
  save(subscription: Subscription): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  /** `SELECT … FOR UPDATE`. */
  lockById(id: string): Promise<Subscription | null>;
  listByUser(
    userId: string,
    filter: { status?: SubscriptionStatus },
    page: PageRequest,
  ): Promise<Page<Subscription>>;
  listAll(
    filter: { userId?: string; status?: SubscriptionStatus },
    page: PageRequest,
  ): Promise<Page<Subscription>>;
  /** ACTIVE subscriptions whose current period contains `at`, locked `FOR UPDATE`. */
  lockActiveForUser(userId: string, at: Date): Promise<Subscription[]>;
  /** Same filter as lockActiveForUser, without locks (read-only summaries). */
  findActiveForUser(userId: string, at: Date): Promise<Subscription[]>;
  /** Next subscription due for renewal or expiry, `FOR UPDATE SKIP LOCKED LIMIT 1`. */
  lockNextDue(now: Date): Promise<Subscription | null>;
  metrics(): Promise<SubscriptionMetrics>;
}
