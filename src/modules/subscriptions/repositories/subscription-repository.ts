import { and, asc, count, desc, eq, gt, lte, or } from 'drizzle-orm';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { DbContext } from '../../../shared/infrastructure/db/context.js';
import { cursorCondition, toPage } from '../../../shared/infrastructure/db/pagination.js';
import { Subscription, type SubscriptionStatus } from '../domain/entities/subscription.js';
import type { SubscriptionMetrics, SubscriptionRepository } from '../domain/ports/subscription-repository.js';
import { usd } from '../domain/value-objects/money.js';
import { subscriptions } from './schema.js';

type Row = typeof subscriptions.$inferSelect;

const toEntity = (row: Row): Subscription =>
  Subscription.rehydrate({
    id: row.id,
    userId: row.userId,
    tier: row.tier,
    billingCycle: row.billingCycle,
    maxMessages: row.maxMessages,
    usedMessages: row.usedMessages,
    price: usd(row.priceCents),
    status: row.status,
    inactiveReason: row.inactiveReason,
    autoRenew: row.autoRenew,
    startDate: row.startDate,
    currentPeriodStart: row.currentPeriodStart,
    endDate: row.endDate,
    renewalDate: row.renewalDate,
    renewalCount: row.renewalCount,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toRow = (s: Subscription): typeof subscriptions.$inferInsert => ({
  id: s.id,
  userId: s.userId,
  tier: s.tier,
  billingCycle: s.billingCycle,
  maxMessages: s.maxMessages,
  usedMessages: s.usedMessages,
  priceCents: s.price.amountCents,
  currency: s.price.currency,
  status: s.status,
  inactiveReason: s.inactiveReason,
  autoRenew: s.autoRenew,
  startDate: s.startDate,
  currentPeriodStart: s.currentPeriodStart,
  endDate: s.endDate,
  renewalDate: s.renewalDate,
  renewalCount: s.renewalCount,
  cancelledAt: s.cancelledAt,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly ctx: DbContext) {}

  async insert(subscription: Subscription): Promise<void> {
    await this.ctx.executor().insert(subscriptions).values(toRow(subscription));
  }

  async save(subscription: Subscription): Promise<void> {
    const { id, ...changes } = toRow(subscription);
    await this.ctx.executor().update(subscriptions).set(changes).where(eq(subscriptions.id, id));
  }

  async findById(id: string): Promise<Subscription | null> {
    const [row] = await this.ctx.executor().select().from(subscriptions).where(eq(subscriptions.id, id));
    return row ? toEntity(row) : null;
  }

  async lockById(id: string): Promise<Subscription | null> {
    const [row] = await this.ctx
      .executor()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .for('update');
    return row ? toEntity(row) : null;
  }

  listByUser(
    userId: string,
    filter: { status?: SubscriptionStatus },
    page: PageRequest,
  ): Promise<Page<Subscription>> {
    return this.list({ userId, status: filter.status }, page);
  }

  listAll(
    filter: { userId?: string; status?: SubscriptionStatus },
    page: PageRequest,
  ): Promise<Page<Subscription>> {
    return this.list(filter, page);
  }

  private async list(
    filter: { userId?: string; status?: SubscriptionStatus },
    page: PageRequest,
  ): Promise<Page<Subscription>> {
    const rows = await this.ctx
      .executor()
      .select()
      .from(subscriptions)
      .where(
        and(
          filter.userId === undefined ? undefined : eq(subscriptions.userId, filter.userId),
          filter.status === undefined ? undefined : eq(subscriptions.status, filter.status),
          cursorCondition(subscriptions.createdAt, subscriptions.id, page.cursor),
        ),
      )
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(page.limit + 1);
    return toPage(rows.map(toEntity), page.limit, (s) => ({ createdAt: s.createdAt, id: s.id }));
  }

  private activeAt(userId: string, at: Date) {
    return and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, 'ACTIVE'),
      lte(subscriptions.currentPeriodStart, at),
      gt(subscriptions.endDate, at),
    );
  }

  async lockActiveForUser(userId: string, at: Date): Promise<Subscription[]> {
    const rows = await this.ctx
      .executor()
      .select()
      .from(subscriptions)
      .where(this.activeAt(userId, at))
      .orderBy(desc(subscriptions.startDate))
      .for('update');
    return rows.map(toEntity);
  }

  async findActiveForUser(userId: string, at: Date): Promise<Subscription[]> {
    const rows = await this.ctx
      .executor()
      .select()
      .from(subscriptions)
      .where(this.activeAt(userId, at))
      .orderBy(desc(subscriptions.startDate));
    return rows.map(toEntity);
  }

  async lockNextDue(now: Date): Promise<Subscription | null> {
    const [row] = await this.ctx
      .executor()
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'ACTIVE'),
          or(
            and(eq(subscriptions.autoRenew, true), lte(subscriptions.renewalDate, now)),
            and(eq(subscriptions.autoRenew, false), lte(subscriptions.endDate, now)),
          ),
        ),
      )
      .orderBy(asc(subscriptions.endDate))
      .limit(1)
      .for('update', { skipLocked: true });
    return row ? toEntity(row) : null;
  }

  async metrics(): Promise<SubscriptionMetrics> {
    const db = this.ctx.executor();
    const active = await db
      .select({
        tier: subscriptions.tier,
        cycle: subscriptions.billingCycle,
        autoRenew: subscriptions.autoRenew,
        n: count(),
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'ACTIVE'))
      .groupBy(subscriptions.tier, subscriptions.billingCycle, subscriptions.autoRenew);
    const inactive = await db
      .select({ reason: subscriptions.inactiveReason, n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'INACTIVE'))
      .groupBy(subscriptions.inactiveReason);
    const result: SubscriptionMetrics = {
      activeByTier: { BASIC: 0, PRO: 0, ENTERPRISE: 0 },
      activeByCycle: { MONTHLY: 0, YEARLY: 0 },
      autoRenewEnabled: 0,
      inactiveByReason: { PAYMENT_FAILED: 0, CANCELLED: 0, EXPIRED: 0 },
    };
    for (const row of active) {
      result.activeByTier[row.tier] += row.n;
      result.activeByCycle[row.cycle] += row.n;
      if (row.autoRenew) result.autoRenewEnabled += row.n;
    }
    for (const row of inactive) {
      if (row.reason !== null) result.inactiveByReason[row.reason] += row.n;
    }
    return result;
  }
}
