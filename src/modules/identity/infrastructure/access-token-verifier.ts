import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { DependencyUnavailableError } from '../../../shared/domain/errors.js';
import { isRecord } from '../../../shared/domain/guards.js';
import { AuthenticationError } from '../domain/errors.js';
import type { AccessTokenVerifier } from '../domain/ports.js';
import { extractRoles, readClaimPath } from '../domain/roles.js';
import type { VerifiedAccessToken } from '../domain/verified-token.js';

export interface AccessTokenVerifierOptions {
  issuer: string;
  audience: string;
  allowedAlgs: readonly string[];
  clockToleranceSec: number;
  rolesClaim: string;
  /** createRemoteJWKSet(...) in production, createLocalJWKSet(...) in unit tests. */
  keys: JWTVerifyGetKey;
}

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Separates "the IdP's JWKS endpoint failed" from "the token is bad". jose reports a timeout as JWKSTimeout, a non-200
 * answer as a generic JOSEError, an unparsable key set as JWKSInvalid, and a network failure as the TypeError thrown by
 * fetch. Everything else (including TypeErrors raised while parsing a malformed token) is the caller's fault.
 */
function isJwksFetchFailure(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
  if (error instanceof errors.JOSEError) return error.message.startsWith('Expected 200 OK');
  return error instanceof TypeError && error.message === 'fetch failed';
}

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly options: AccessTokenVerifierOptions) {}

  async verify(token: string, now: Date): Promise<VerifiedAccessToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: [...this.options.allowedAlgs],
        clockTolerance: this.options.clockToleranceSec,
        currentDate: now,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      if (isJwksFetchFailure(error)) {
        // The IdP's key endpoint is unreachable or broken and no cached key matched: not the caller's fault.
        throw new DependencyUnavailableError('identity-provider-jwks');
      }
      if (error instanceof errors.JOSEError) {
        throw new AuthenticationError('invalid_token', `${error.code}: ${error.message}`);
      }
      throw new AuthenticationError('invalid_token', `token could not be verified: ${String(error)}`);
    }

    const cnf = isRecord(payload.cnf) ? payload.cnf : null;
    const jkt = optionalString(cnf?.jkt);
    if (!jkt)
      throw new AuthenticationError('invalid_token', 'token is not sender-constrained (missing cnf.jkt)');
    const subject = optionalString(payload.sub);
    const issuer = optionalString(payload.iss);
    if (!subject || !issuer || typeof payload.exp !== 'number') {
      throw new AuthenticationError('invalid_token', 'token is missing sub, iss or exp');
    }
    return {
      issuer,
      subject,
      tokenId: optionalString(payload.jti),
      sessionId: optionalString(payload.sid),
      expiresAt: new Date(payload.exp * 1000),
      jkt,
      roles: extractRoles(readClaimPath(payload, this.options.rolesClaim)),
      email: optionalString(payload.email),
      name: optionalString(payload.name),
    };
  }
}
