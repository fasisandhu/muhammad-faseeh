import { DomainError } from '../../../shared/domain/errors.js';

export type AuthChallenge = 'missing' | 'invalid_token' | 'invalid_dpop_proof';

const MESSAGES: Record<AuthChallenge, string> = {
  missing: 'Authentication is required: send "Authorization: DPoP <token>" and a "DPoP" proof header.',
  invalid_token: 'The access token is invalid, expired or revoked.',
  invalid_dpop_proof: 'The DPoP proof is invalid.',
};

/** 401. `reason` explains the exact failure for logs; clients only ever see the challenge. */
export class AuthenticationError extends DomainError<{ challenge: AuthChallenge }> {
  constructor(
    readonly challenge: AuthChallenge,
    readonly reason: string,
  ) {
    super('UNAUTHENTICATED', MESSAGES[challenge], { challenge });
  }
}
