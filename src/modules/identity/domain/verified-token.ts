import type { Role } from '../../../shared/domain/actor.js';

export interface VerifiedAccessToken {
  issuer: string;
  subject: string;
  tokenId: string | null;
  sessionId: string | null;
  expiresAt: Date;
  /** JWK thumbprint the token is bound to (cnf.jkt). */
  jkt: string;
  roles: ReadonlySet<Role>;
  email: string | null;
  name: string | null;
}
