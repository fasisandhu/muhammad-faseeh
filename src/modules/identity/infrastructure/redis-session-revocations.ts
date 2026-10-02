import type { Redis } from 'ioredis';
import { DependencyUnavailableError } from '../../../shared/domain/errors.js';
import type { SessionRevocations } from '../domain/ports.js';

export class RedisSessionRevocations implements SessionRevocations {
  constructor(private readonly redis: Redis) {}

  async revoke(id: string, ttlMs: number): Promise<void> {
    try {
      await this.redis.set(`session:revoked:${id}`, '1', 'PX', ttlMs);
    } catch {
      throw new DependencyUnavailableError('redis');
    }
  }

  async isRevoked(id: string): Promise<boolean> {
    try {
      return (await this.redis.exists(`session:revoked:${id}`)) === 1;
    } catch {
      throw new DependencyUnavailableError('redis');
    }
  }
}
