import type { Express } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createApp } from './app.js';
import { createIdentityModule } from './modules/identity/index.js';
import type { Job } from './shared/application/jobs.js';
import type { Clock } from './shared/domain/clock.js';
import type { IdGenerator } from './shared/domain/ids.js';
import type { RandomSource } from './shared/domain/random.js';
import { createRateLimiters } from './shared/http/rate-limit.js';
import type { AppConfig } from './shared/infrastructure/config/env.js';
import { createDatabase, type DatabaseHandle } from './shared/infrastructure/db/client.js';
import { DbContext } from './shared/infrastructure/db/context.js';
import { createLogger } from './shared/infrastructure/logging/logger.js';
import { connectRedis, createRedis } from './shared/infrastructure/redis/client.js';
import { MathRandomSource } from './shared/infrastructure/system/math-random.js';
import { SystemClock } from './shared/infrastructure/system/system-clock.js';
import { UuidGenerator } from './shared/infrastructure/system/uuid-generator.js';

export interface ContainerOverrides {
  clock?: Clock;
  ids?: IdGenerator;
  logger?: Logger;
  userCacheTtlMs?: number;
  paymentRandom?: RandomSource;
  llmRandom?: RandomSource;
}

export interface Container {
  app: Express;
  config: AppConfig;
  logger: Logger;
  database: DatabaseHandle;
  db: DbContext;
  redis: Redis;
  jobs: Job[];
  close(): Promise<void>;
}

/** Composition root: the only place that knows every concrete class. main.ts and the tests both use it. */
export async function buildContainer(
  config: AppConfig,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  const logger =
    overrides.logger ?? createLogger({ level: config.logLevel, pretty: config.nodeEnv === 'development' });
  const clock = overrides.clock ?? new SystemClock();
  const ids = overrides.ids ?? new UuidGenerator();
  const paymentRandom = overrides.paymentRandom ?? new MathRandomSource();
  const llmRandom = overrides.llmRandom ?? new MathRandomSource();

  const database = createDatabase(config.database.url, config.database.poolMax, (err) => {
    logger.error({ err }, 'postgres pool error');
  });
  const db = new DbContext(database.db);
  const redis = createRedis(config.redis.url);
  await connectRedis(redis);
  const rateLimiters = createRateLimiters(redis, config.rateLimits);

  const identity = createIdentityModule({
    config,
    db,
    redis,
    clock,
    logger,
    limiters: rateLimiters,
    userCacheTtlMs: overrides.userCacheTtlMs,
  });
  // MODULES: Tasks 10–13 create the subscriptions, chat and admin modules here and append their routes/jobs.
  // Placeholders until those modules consume the values; each task deletes its own line.
  /* eslint-disable @typescript-eslint/no-meaningless-void-operator */
  void ids;
  void paymentRandom;
  void llmRandom;
  /* eslint-enable @typescript-eslint/no-meaningless-void-operator */
  const routes = [...identity.routes];
  const jobs: Job[] = [];

  const app = createApp({
    config,
    logger,
    rateLimiters,
    authenticate: identity.authenticate,
    routes,
    health: {
      database: () => database.ping(),
      redis: async () => {
        await redis.ping();
      },
    },
  });

  return {
    app,
    config,
    logger,
    database,
    db,
    redis,
    jobs,
    close: async () => {
      redis.disconnect();
      await database.close();
    },
  };
}
