import type { Redis } from 'ioredis';
import { DependencyUnavailableError } from '../../../shared/domain/errors.js';
import type { ReplayCache } from '../domain/ports.js';

/** SET NX PX: atomic "first time seen?" shared by every API instance. Fails closed when Redis is down. */
export class RedisReplayCache implements ReplayCache {
  constructor(private readonly redis: Redis) {}

  async markIfUnseen(key: string, ttlMs: number): Promise<boolean> {
    try {
      return (await this.redis.set(`dpop:jti:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
    } catch {
      throw new DependencyUnavailableError('redis');
    }
  }
}
