import { LRUCache } from 'lru-cache';
import type { Clock } from '../../../shared/domain/clock.js';
import type { UserRepository } from '../domain/ports.js';

/** Just-in-time provisioning of IdP users. The cache avoids one write per request (cacheTtlMs 0 disables it). */
export class ProvisionUser {
  private readonly cache: LRUCache<string, string> | null;

  constructor(
    private readonly users: UserRepository,
    private readonly clock: Clock,
    options: { cacheTtlMs: number },
  ) {
    this.cache = options.cacheTtlMs > 0 ? new LRUCache({ max: 10_000, ttl: options.cacheTtlMs }) : null;
  }

  async execute(identity: {
    issuer: string;
    subject: string;
    email: string | null;
    displayName: string | null;
  }): Promise<string> {
    const key = `${identity.issuer}|${identity.subject}`;
    const cached = this.cache?.get(key);
    if (cached !== undefined) return cached;
    const id = await this.users.upsert({ ...identity, seenAt: this.clock.now() });
    this.cache?.set(key, id);
    return id;
  }
}
