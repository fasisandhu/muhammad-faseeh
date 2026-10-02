import { describe, expect, it, vi } from 'vitest';
import { AskQuestion } from '../../../../src/modules/chat/application/ask-question.js';
import { GetMyUsage } from '../../../../src/modules/chat/application/get-my-usage.js';
import { ChatMessage } from '../../../../src/modules/chat/domain/entities/chat-message.js';
import { MonthlyUsage } from '../../../../src/modules/chat/domain/entities/monthly-usage.js';
import { ChatRequestAbortedError } from '../../../../src/modules/chat/domain/errors.js';
import type {
  BundleConsumeResult,
  BundleQuotaPort,
} from '../../../../src/modules/chat/domain/ports/bundle-quota-port.js';
import type { ChatMessageRepository } from '../../../../src/modules/chat/domain/ports/chat-message-repository.js';
import type { LlmClient } from '../../../../src/modules/chat/domain/ports/llm-client.js';
import type { UsageRepository } from '../../../../src/modules/chat/domain/ports/usage-repository.js';
import { Question } from '../../../../src/modules/chat/domain/value-objects/question.js';
import { TokenUsage } from '../../../../src/modules/chat/domain/value-objects/token-usage.js';
import type { UsagePeriod } from '../../../../src/modules/chat/domain/value-objects/usage-period.js';
import type { TransactionManager } from '../../../../src/shared/application/transaction.js';
import { Actor } from '../../../../src/shared/domain/actor.js';
import { FakeClock } from '../../../support/fake-clock.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BUNDLE_ID = '00000000-0000-4000-8000-0000000000b1';
const BUNDLE_PERIOD_START = new Date('2026-10-01T00:00:00.000Z');

const copyUsage = (u: MonthlyUsage): MonthlyUsage =>
  MonthlyUsage.rehydrate({
    userId: u.userId,
    period: u.period,
    freeUsed: u.freeUsed,
    paidUsed: u.paidUsed,
    totalTokens: u.totalTokens,
  });

const copyMessage = (m: ChatMessage): ChatMessage =>
  ChatMessage.rehydrate({
    id: m.id,
    userId: m.userId,
    question: m.question,
    status: m.status,
    charge: m.charge,
    answer: m.answer,
    model: m.model,
    tokenUsage: m.tokenUsage,
    failureCode: m.failureCode,
    requestId: m.requestId,
    createdAt: m.createdAt,
    completedAt: m.completedAt,
    latencyMs: m.latencyMs,
  });

/** In-memory stores behind a transaction manager that rolls back on error, like the real one. */
function setup(options: {
  freeMessagesPerMonth: number;
  onUsageLock?: (call: number) => void;
  onMessageSave?: (message: ChatMessage) => void;
}) {
  let usageRows = new Map<string, MonthlyUsage>();
  let messageRows = new Map<string, ChatMessage>();
  let bundleUsed = 0;
  let usageLocks = 0;

  const tx: TransactionManager = {
    async run(work) {
      const snapshot = { usageRows: new Map(usageRows), messageRows: new Map(messageRows), bundleUsed };
      try {
        return await work();
      } catch (error) {
        ({ usageRows, messageRows, bundleUsed } = snapshot);
        throw error;
      }
    },
  };
  const key = (userId: string, period: UsagePeriod) => `${userId}:${period.value}`;
  const usage: UsageRepository = {
    lockForUpdate(userId, period) {
      usageLocks += 1;
      options.onUsageLock?.(usageLocks);
      const found = usageRows.get(key(userId, period));
      return Promise.resolve(found ? copyUsage(found) : MonthlyUsage.start(userId, period));
    },
    find(userId, period) {
      const found = usageRows.get(key(userId, period));
      return Promise.resolve(found ? copyUsage(found) : null);
    },
    save(u) {
      usageRows.set(key(u.userId, u.period), copyUsage(u));
      return Promise.resolve();
    },
  };
  const messages: ChatMessageRepository = {
    insert(m) {
      messageRows.set(m.id, copyMessage(m));
      return Promise.resolve();
    },
    save(m) {
      messageRows.set(m.id, copyMessage(m));
      options.onMessageSave?.(m);
      return Promise.resolve();
    },
    findById(id) {
      const found = messageRows.get(id);
      return Promise.resolve(found ? copyMessage(found) : null);
    },
    listByUser: () => Promise.reject(new Error('not used')),
    listAll: () => Promise.reject(new Error('not used')),
    findStalePending: () => Promise.reject(new Error('not used')),
    usageMetrics: () => Promise.reject(new Error('not used')),
  };
  const bundles = {
    consumeOne: vi.fn((): Promise<BundleConsumeResult> => {
      bundleUsed += 1;
      return Promise.resolve({
        kind: 'charged',
        subscriptionId: BUNDLE_ID,
        bundlePeriodStart: BUNDLE_PERIOD_START,
      });
    }),
    refund: vi.fn(() => {
      bundleUsed -= 1;
      return Promise.resolve();
    }),
    summary: vi.fn(() => Promise.resolve([])),
  } satisfies BundleQuotaPort;
  const llm: LlmClient = {
    complete: () =>
      Promise.resolve({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        content: 'an answer',
        finishReason: 'stop',
        usage: TokenUsage.of(10, 5),
      }),
  };
  const clock = new FakeClock();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    tx,
    usage,
    messages,
    bundles,
    clock,
    ids: { next: () => '00000000-0000-4000-8000-00000000c0de' },
    logger,
  };
  const ask = new AskQuestion({
    ...deps,
    llm,
    llmTimeoutMs: 1_000,
    freeMessagesPerMonth: options.freeMessagesPerMonth,
    usageQuery: new GetMyUsage({ usage, bundles, clock, freeMessagesPerMonth: options.freeMessagesPerMonth }),
  });
  return {
    ask,
    bundles,
    logger,
    state: () => ({ usage: [...usageRows.values()], messages: [...messageRows.values()], bundleUsed }),
  };
}

const actor = new Actor(USER_ID, 'kc-subject', ['user']);
const input = (signal: AbortSignal) => ({
  actor,
  question: Question.create('What is DPoP?'),
  requestId: 'req-1',
  signal,
});

describe('AskQuestion when the request deadline fires while the answer is being stored', () => {
  // Lock 1 is taken by the reservation, lock 2 by finalize: aborting there simulates the 10 s deadline
  // firing while finalize waits for the usage-row lock.
  it('refunds a free charge and marks the message FAILED instead of completing it', async () => {
    const request = new AbortController();
    const t = setup({
      freeMessagesPerMonth: 3,
      onUsageLock: (call) => {
        if (call === 2) request.abort(new Error('request deadline exceeded'));
      },
    });

    await expect(t.ask.execute(input(request.signal))).rejects.toBeInstanceOf(ChatRequestAbortedError);

    const { usage, messages } = t.state();
    expect(usage[0]).toMatchObject({ freeUsed: 0, paidUsed: 0, totalTokens: 0 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: 'FAILED', failureCode: 'REQUEST_ABORTED', answer: null });
    expect(t.bundles.summary).not.toHaveBeenCalled();
  });

  it('refunds a bundle charge into the charged bundle period', async () => {
    const request = new AbortController();
    const t = setup({
      freeMessagesPerMonth: 0,
      onUsageLock: (call) => {
        if (call === 2) request.abort(new Error('request deadline exceeded'));
      },
    });

    await expect(t.ask.execute(input(request.signal))).rejects.toBeInstanceOf(ChatRequestAbortedError);

    const { usage, messages, bundleUsed } = t.state();
    expect(usage[0]).toMatchObject({ freeUsed: 0, paidUsed: 0 });
    expect(bundleUsed).toBe(0);
    expect(t.bundles.refund).toHaveBeenCalledWith(
      { subscriptionId: BUNDLE_ID, bundlePeriodStart: BUNDLE_PERIOD_START },
      expect.any(Date),
    );
    expect(messages[0]).toMatchObject({ status: 'FAILED', failureCode: 'REQUEST_ABORTED' });
  });

  it('keeps the stored answer but skips the quota summary when the deadline fires right after the commit', async () => {
    const request = new AbortController();
    const t = setup({
      freeMessagesPerMonth: 3,
      onMessageSave: (m) => {
        if (m.status === 'COMPLETED') request.abort(new Error('request deadline exceeded'));
      },
    });

    await expect(t.ask.execute(input(request.signal))).rejects.toThrow('request deadline exceeded');

    const { usage, messages } = t.state();
    expect(messages[0]).toMatchObject({ status: 'COMPLETED', answer: 'an answer' });
    expect(usage[0]).toMatchObject({ freeUsed: 1, totalTokens: 15 });
    expect(t.bundles.summary).not.toHaveBeenCalled();
    expect(t.logger.warn).toHaveBeenCalledWith(
      { messageId: messages[0]?.id },
      'answer stored after the request was cancelled',
    );
  });

  it('completes and charges normally when the request is still alive', async () => {
    const t = setup({ freeMessagesPerMonth: 3 });

    const result = await t.ask.execute(input(new AbortController().signal));

    expect(result.message.status).toBe('COMPLETED');
    expect(result.quota.free).toMatchObject({ used: 1, remaining: 2 });
    expect(t.state().usage[0]).toMatchObject({ freeUsed: 1, totalTokens: 15 });
    expect(t.bundles.summary).toHaveBeenCalledTimes(1);
  });
});
