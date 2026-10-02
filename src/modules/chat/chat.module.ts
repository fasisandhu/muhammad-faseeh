import type { Job } from '../../shared/application/jobs.js';
import type { Logger } from '../../shared/application/logger.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/ids.js';
import type { RandomSource } from '../../shared/domain/random.js';
import type { Route } from '../../shared/http/routing.js';
import type { AppConfig } from '../../shared/infrastructure/config/env.js';
import type { DbContext } from '../../shared/infrastructure/db/context.js';
import { AskQuestion } from './application/ask-question.js';
import type { ChatDeps } from './application/chat-deps.js';
import { GetMyMessage } from './application/get-my-message.js';
import { GetMyUsage } from './application/get-my-usage.js';
import { GetUsageMetrics } from './application/get-usage-metrics.js';
import { ListAllMessages } from './application/list-all-messages.js';
import { ListMyMessages } from './application/list-my-messages.js';
import { SweepStaleReservations } from './application/sweep-stale-reservations.js';
import { chatRoutes } from './controllers/chat-routes.js';
import type { BundleQuotaPort } from './domain/ports/bundle-quota-port.js';
import type { LlmClient } from './domain/ports/llm-client.js';
import { MockOpenAiClient } from './infrastructure/mock-openai-client.js';
import { DrizzleChatMessageRepository } from './repositories/chat-message-repository.js';
import { DrizzleUsageRepository } from './repositories/usage-repository.js';

export interface ChatModuleDeps {
  config: AppConfig;
  db: DbContext;
  clock: Clock;
  ids: IdGenerator;
  random: RandomSource;
  logger: Logger;
  bundles: BundleQuotaPort;
  llm?: LlmClient;
}

export interface ChatModule {
  routes: Route[];
  jobs: Job[];
  queries: { usageMetrics: GetUsageMetrics; listAll: ListAllMessages };
}

export function createChatModule(deps: ChatModuleDeps): ChatModule {
  const { config } = deps;
  const usage = new DrizzleUsageRepository(deps.db);
  const messages = new DrizzleChatMessageRepository(deps.db);
  const common: ChatDeps = {
    tx: deps.db,
    usage,
    messages,
    bundles: deps.bundles,
    clock: deps.clock,
    ids: deps.ids,
    logger: deps.logger,
  };
  const llm =
    deps.llm ??
    new MockOpenAiClient({
      model: config.llm.model,
      minLatencyMs: config.llm.minLatencyMs,
      maxLatencyMs: config.llm.maxLatencyMs,
      failureRate: config.llm.failureRate,
      random: deps.random,
      ids: deps.ids,
      clock: deps.clock,
    });
  const usageQuery = new GetMyUsage({
    usage,
    bundles: deps.bundles,
    clock: deps.clock,
    freeMessagesPerMonth: config.quota.freeMessagesPerMonth,
  });
  const sweeper = new SweepStaleReservations({
    ...common,
    pendingTimeoutMs: config.jobs.pendingMessageTimeoutSec * 1000,
  });
  return {
    routes: chatRoutes({
      ask: new AskQuestion({
        ...common,
        llm,
        llmTimeoutMs: config.llm.timeoutMs,
        freeMessagesPerMonth: config.quota.freeMessagesPerMonth,
        usageQuery,
      }),
      list: new ListMyMessages(messages),
      get: new GetMyMessage(messages),
      usage: usageQuery,
    }),
    jobs: [{ name: 'chat-reservation-sweeper', run: () => sweeper.execute() }],
    queries: {
      usageMetrics: new GetUsageMetrics({ messages, clock: deps.clock }),
      listAll: new ListAllMessages(messages),
    },
  };
}
