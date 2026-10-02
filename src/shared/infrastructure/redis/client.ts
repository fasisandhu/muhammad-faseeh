import { Redis } from 'ioredis';

/** Fails fast instead of queueing commands while disconnected, so callers can degrade or fail closed. */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
}

export async function connectRedis(redis: Redis): Promise<void> {
  await redis.connect();
}
