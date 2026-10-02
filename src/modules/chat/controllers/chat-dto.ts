import type { QuotaSummary } from '../application/get-my-usage.js';
import type { ChatMessage } from '../domain/entities/chat-message.js';

export const messageDto = (m: ChatMessage) => ({
  id: m.id,
  question: m.question.value,
  answer: m.answer,
  status: m.status,
  model: m.model,
  usage: m.tokenUsage
    ? {
        promptTokens: m.tokenUsage.promptTokens,
        completionTokens: m.tokenUsage.completionTokens,
        totalTokens: m.tokenUsage.totalTokens,
      }
    : null,
  charge:
    m.charge.kind === 'FREE'
      ? { source: 'FREE' as const, period: m.charge.period.value }
      : { source: 'BUNDLE' as const, period: m.charge.period.value, subscriptionId: m.charge.subscriptionId },
  failureCode: m.failureCode,
  requestId: m.requestId,
  createdAt: m.createdAt.toISOString(),
  completedAt: m.completedAt ? m.completedAt.toISOString() : null,
  latencyMs: m.latencyMs,
});

export const quotaDto = (q: QuotaSummary) => ({
  period: q.period,
  free: {
    limit: q.free.limit,
    used: q.free.used,
    remaining: q.free.remaining,
    resetsAt: q.free.resetsAt.toISOString(),
  },
  paidUsed: q.paidUsed,
  totalTokens: q.totalTokens,
  bundles: q.bundles.map((b) => ({
    subscriptionId: b.subscriptionId,
    tier: b.tier,
    remainingMessages: b.remainingMessages,
    periodEndsAt: b.periodEndsAt.toISOString(),
  })),
});
