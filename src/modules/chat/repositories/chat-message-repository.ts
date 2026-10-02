import { and, asc, count, countDistinct, desc, eq, lt, sum } from 'drizzle-orm';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import type { DbContext } from '../../../shared/infrastructure/db/context.js';
import { cursorCondition, toPage } from '../../../shared/infrastructure/db/pagination.js';
import { ChatMessage } from '../domain/entities/chat-message.js';
import type { ChatMessageRepository, UsageMetrics } from '../domain/ports/chat-message-repository.js';
import { Question } from '../domain/value-objects/question.js';
import { bundleCharge, freeCharge, type QuotaCharge } from '../domain/value-objects/quota-charge.js';
import { TokenUsage } from '../domain/value-objects/token-usage.js';
import { UsagePeriod } from '../domain/value-objects/usage-period.js';
import { chatMessages } from './schema.js';

type Row = typeof chatMessages.$inferSelect;

function chargeOf(row: Row): QuotaCharge {
  const period = UsagePeriod.parse(row.chargePeriod);
  if (row.chargeKind === 'FREE') return freeCharge(period);
  if (row.subscriptionId === null || row.bundlePeriodStart === null) {
    throw new Error(`chat message ${row.id} has an incomplete bundle charge`);
  }
  return bundleCharge(period, row.subscriptionId, row.bundlePeriodStart);
}

const toEntity = (row: Row): ChatMessage =>
  ChatMessage.rehydrate({
    id: row.id,
    userId: row.userId,
    question: Question.create(row.question),
    status: row.status,
    charge: chargeOf(row),
    answer: row.answer,
    model: row.model,
    tokenUsage:
      row.promptTokens !== null && row.completionTokens !== null
        ? TokenUsage.of(row.promptTokens, row.completionTokens)
        : null,
    failureCode: row.failureCode,
    requestId: row.requestId,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    latencyMs: row.latencyMs,
  });

const toRow = (m: ChatMessage): typeof chatMessages.$inferInsert => ({
  id: m.id,
  userId: m.userId,
  question: m.question.value,
  answer: m.answer,
  status: m.status,
  chargeKind: m.charge.kind,
  chargePeriod: m.charge.period.value,
  subscriptionId: m.charge.kind === 'BUNDLE' ? m.charge.subscriptionId : null,
  bundlePeriodStart: m.charge.kind === 'BUNDLE' ? m.charge.bundlePeriodStart : null,
  model: m.model,
  promptTokens: m.tokenUsage?.promptTokens ?? null,
  completionTokens: m.tokenUsage?.completionTokens ?? null,
  totalTokens: m.tokenUsage?.totalTokens ?? null,
  failureCode: m.failureCode,
  requestId: m.requestId,
  latencyMs: m.latencyMs,
  createdAt: m.createdAt,
  completedAt: m.completedAt,
});

export class DrizzleChatMessageRepository implements ChatMessageRepository {
  constructor(private readonly ctx: DbContext) {}

  async insert(message: ChatMessage): Promise<void> {
    await this.ctx.executor().insert(chatMessages).values(toRow(message));
  }

  async save(message: ChatMessage): Promise<void> {
    const { id, ...changes } = toRow(message);
    await this.ctx.executor().update(chatMessages).set(changes).where(eq(chatMessages.id, id));
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const [row] = await this.ctx.executor().select().from(chatMessages).where(eq(chatMessages.id, id));
    return row ? toEntity(row) : null;
  }

  async lockById(id: string): Promise<ChatMessage | null> {
    const [row] = await this.ctx
      .executor()
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, id))
      .for('update', { skipLocked: true });
    return row ? toEntity(row) : null;
  }

  listByUser(userId: string, page: PageRequest): Promise<Page<ChatMessage>> {
    return this.list({ userId }, page);
  }

  listAll(filter: { userId?: string }, page: PageRequest): Promise<Page<ChatMessage>> {
    return this.list(filter, page);
  }

  private async list(filter: { userId?: string }, page: PageRequest): Promise<Page<ChatMessage>> {
    const rows = await this.ctx
      .executor()
      .select()
      .from(chatMessages)
      .where(
        and(
          filter.userId === undefined ? undefined : eq(chatMessages.userId, filter.userId),
          cursorCondition(chatMessages.createdAt, chatMessages.id, page.cursor),
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(page.limit + 1);
    return toPage(rows.map(toEntity), page.limit, (m) => ({ createdAt: m.createdAt, id: m.id }));
  }

  async findStalePending(olderThan: Date, limit: number): Promise<ChatMessage[]> {
    const rows = await this.ctx
      .executor()
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.status, 'PENDING'), lt(chatMessages.createdAt, olderThan)))
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit);
    return rows.map(toEntity);
  }

  async usageMetrics(period: UsagePeriod): Promise<UsageMetrics> {
    const db = this.ctx.executor();
    const rows = await db
      .select({
        status: chatMessages.status,
        kind: chatMessages.chargeKind,
        n: count(),
        prompt: sum(chatMessages.promptTokens),
        completion: sum(chatMessages.completionTokens),
        total: sum(chatMessages.totalTokens),
      })
      .from(chatMessages)
      .where(eq(chatMessages.chargePeriod, period.value))
      .groupBy(chatMessages.status, chatMessages.chargeKind);
    const [active] = await db
      .select({ n: countDistinct(chatMessages.userId) })
      .from(chatMessages)
      .where(eq(chatMessages.chargePeriod, period.value));
    const metrics: UsageMetrics = {
      period: period.value,
      messages: { total: 0, free: 0, paid: 0, failed: 0 },
      tokens: { prompt: 0, completion: 0, total: 0 },
      activeUsers: active?.n ?? 0,
    };
    for (const row of rows) {
      metrics.messages.total += row.n;
      if (row.status === 'FAILED') {
        metrics.messages.failed += row.n;
      } else if (row.kind === 'FREE') {
        metrics.messages.free += row.n;
      } else {
        metrics.messages.paid += row.n;
      }
      metrics.tokens.prompt += Number(row.prompt ?? 0);
      metrics.tokens.completion += Number(row.completion ?? 0);
      metrics.tokens.total += Number(row.total ?? 0);
    }
    return metrics;
  }
}
