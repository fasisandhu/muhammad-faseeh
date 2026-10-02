import type { AuthContext } from '../../../shared/domain/auth-context.js';
import type { SessionRevocations } from '../domain/ports.js';

/** Revokes the IdP session behind the token (or the token itself when it has no sid). */
export class Logout {
  constructor(
    private readonly revocations: SessionRevocations,
    private readonly ttlMs: number,
  ) {}

  async execute(auth: AuthContext): Promise<void> {
    const id = auth.token.sessionId ?? auth.token.id;
    if (id !== null) await this.revocations.revoke(id, this.ttlMs);
  }
}
