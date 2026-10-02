import { and, eq, sql } from 'drizzle-orm';
import type { DbContext } from '../../../shared/infrastructure/db/context.js';
import { MonthlyUsage } from '../domain/entities/monthly-usage.js';
import type { UsageRepository } from '../domain/ports/usage-repository.js';
import { UsagePeriod } from '../domain/value-objects/usage-period.js';
import { monthlyUsage } from './schema.js';

type Row = typeof monthlyUsage.$inferSelect;

const toEntity = (row: Row): MonthlyUsage =>
  MonthlyUsage.rehydrate({
    userId: row.userId,
    period: UsagePeriod.parse(row.period),
    freeUsed: row.freeUsed,
    paidUsed: row.paidUsed,
    totalTokens: row.totalTokens,
  });

const byKey = (userId: string, period: UsagePeriod) =>
  and(eq(monthlyUsage.userId, userId), eq(monthlyUsage.period, period.value));

export class DrizzleUsageRepository implements UsageRepository {
  constructor(private readonly ctx: DbContext) {}

  /**
   * INSERT … ON CONFLICT DO NOTHING, then SELECT … FOR UPDATE. Concurrent first requests of a month queue on the
   * unique key, then on the row lock — every quota decision for a user is serialised here.
   */
  async lockForUpdate(userId: string, period: UsagePeriod): Promise<MonthlyUsage> {
    const db = this.ctx.executor();
    await db.insert(monthlyUsage).values({ userId, period: period.value }).onConflictDoNothing();
    const [row] = await db.select().from(monthlyUsage).where(byKey(userId, period)).for('update');
    if (!row) throw new Error('monthly_usage row missing after upsert');
    return toEntity(row);
  }

  async find(userId: string, period: UsagePeriod): Promise<MonthlyUsage | null> {
    const [row] = await this.ctx.executor().select().from(monthlyUsage).where(byKey(userId, period));
    return row ? toEntity(row) : null;
  }

  async save(usage: MonthlyUsage): Promise<void> {
    await this.ctx
      .executor()
      .update(monthlyUsage)
      .set({
        freeUsed: usage.freeUsed,
        paidUsed: usage.paidUsed,
        totalTokens: usage.totalTokens,
        updatedAt: sql`now()`,
      })
      .where(byKey(usage.userId, usage.period));
  }
}
