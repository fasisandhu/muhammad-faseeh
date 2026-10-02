import { and, count, eq, gte, sum } from 'drizzle-orm';
import type { DbContext } from '../../../shared/infrastructure/db/context.js';
import { Payment, type PaymentKind } from '../domain/entities/payment.js';
import type { PaymentMetrics, PaymentRepository } from '../domain/ports/payment-repository.js';
import { usd } from '../domain/value-objects/money.js';
import { payments } from './schema.js';

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly ctx: DbContext) {}

  async insert(payment: Payment): Promise<void> {
    await this.ctx.executor().insert(payments).values({
      id: payment.id,
      subscriptionId: payment.subscriptionId,
      userId: payment.userId,
      kind: payment.kind,
      periodStart: payment.periodStart,
      amountCents: payment.amount.amountCents,
      currency: payment.amount.currency,
      status: payment.status,
      providerReference: payment.providerReference,
      failureReason: payment.failureReason,
      attemptedAt: payment.attemptedAt,
    });
  }

  async findFor(subscriptionId: string, kind: PaymentKind, periodStart: Date): Promise<Payment | null> {
    const [row] = await this.ctx
      .executor()
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.subscriptionId, subscriptionId),
          eq(payments.kind, kind),
          eq(payments.periodStart, periodStart),
        ),
      );
    if (!row) return null;
    return Payment.rehydrate({
      id: row.id,
      subscriptionId: row.subscriptionId,
      userId: row.userId,
      kind: row.kind,
      periodStart: row.periodStart,
      amount: usd(row.amountCents),
      status: row.status,
      providerReference: row.providerReference,
      failureReason: row.failureReason,
      attemptedAt: row.attemptedAt,
    });
  }

  async metricsSince(since: Date): Promise<PaymentMetrics> {
    const rows = await this.ctx
      .executor()
      .select({ status: payments.status, n: count(), total: sum(payments.amountCents) })
      .from(payments)
      .where(gte(payments.attemptedAt, since))
      .groupBy(payments.status);
    const metrics: PaymentMetrics = { succeeded: 0, failed: 0, revenueCents: 0 };
    for (const row of rows) {
      if (row.status === 'SUCCEEDED') {
        metrics.succeeded = row.n;
        metrics.revenueCents = Number(row.total ?? 0);
      } else {
        metrics.failed = row.n;
      }
    }
    return metrics;
  }
}
