import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/shared/infrastructure/db/migrate.js';
import { appUrlFrom, provisionAppRole } from './db.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseOwnerUrl: string;
    databaseAppUrl: string;
    redisUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('ggi')
      .withUsername('ggi_owner')
      .withPassword('owner-test-password')
      .start(),
    new RedisContainer('redis:7-alpine').withPassword('redis-test-password').start(),
  ]);
  const ownerUrl = postgres.getConnectionUri();
  await provisionAppRole(ownerUrl);
  await runMigrations(ownerUrl);
  project.provide('databaseOwnerUrl', ownerUrl);
  project.provide('databaseAppUrl', appUrlFrom(ownerUrl));
  project.provide('redisUrl', redis.getConnectionUrl());
  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
