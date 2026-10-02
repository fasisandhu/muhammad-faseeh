import type { Actor } from './actor.js';

/** Everything the transport layer knows about an authenticated request. */
export interface AuthContext {
  readonly actor: Actor;
  readonly email: string | null;
  readonly token: {
    readonly id: string | null;
    readonly sessionId: string | null;
    readonly expiresAt: Date;
    readonly keyThumbprint: string;
  };
}
