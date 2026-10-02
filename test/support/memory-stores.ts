import { DependencyUnavailableError } from '../../src/shared/domain/errors.js';
import type { ReplayCache, SessionRevocations } from '../../src/modules/identity/domain/ports.js';

export class MemoryReplayCache implements ReplayCache {
  private readonly seen = new Set<string>();

  markIfUnseen(key: string): Promise<boolean> {
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    return Promise.resolve(true);
  }
}

export class FailingReplayCache implements ReplayCache {
  markIfUnseen(): Promise<boolean> {
    return Promise.reject(new DependencyUnavailableError('redis'));
  }
}

export class MemorySessionRevocations implements SessionRevocations {
  private readonly revoked = new Set<string>();

  revoke(id: string): Promise<void> {
    this.revoked.add(id);
    return Promise.resolve();
  }

  isRevoked(id: string): Promise<boolean> {
    return Promise.resolve(this.revoked.has(id));
  }
}
