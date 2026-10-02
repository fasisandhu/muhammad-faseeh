import { Actor } from '../../../shared/domain/actor.js';
import type { AuthContext } from '../../../shared/domain/auth-context.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import { AuthenticationError } from '../domain/errors.js';
import type { AccessTokenVerifier, ProofVerifier, SessionRevocations } from '../domain/ports.js';
import type { ProvisionUser } from './provision-user.js';

export interface AuthenticateInput {
  accessToken: string;
  proof: string;
  method: string;
  url: string;
}

/** Token checks (§9.2) → DPoP proof (§9.3) → session revocation (§9.4) → role presence → JIT provisioning. */
export class AuthenticateRequest {
  constructor(
    private readonly deps: {
      tokens: AccessTokenVerifier;
      proofs: ProofVerifier;
      revocations: SessionRevocations;
      provision: ProvisionUser;
      clock: Clock;
    },
  ) {}

  async execute(input: AuthenticateInput): Promise<AuthContext> {
    const now = this.deps.clock.now();
    const token = await this.deps.tokens.verify(input.accessToken, now);
    await this.deps.proofs.verify({
      proof: input.proof,
      method: input.method,
      url: input.url,
      accessToken: input.accessToken,
      expectedJkt: token.jkt,
      now,
    });
    const revocationKey = token.sessionId ?? token.tokenId;
    if (revocationKey !== null && (await this.deps.revocations.isRevoked(revocationKey))) {
      throw new AuthenticationError('invalid_token', 'the session was revoked by logout');
    }
    if (token.roles.size === 0) throw new ForbiddenError('use this API without an application role');
    const userId = await this.deps.provision.execute({
      issuer: token.issuer,
      subject: token.subject,
      email: token.email,
      displayName: token.name,
    });
    return {
      actor: new Actor(userId, token.subject, token.roles),
      email: token.email,
      token: {
        id: token.tokenId,
        sessionId: token.sessionId,
        expiresAt: token.expiresAt,
        keyThumbprint: token.jkt,
      },
    };
  }
}
