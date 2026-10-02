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

/** Raised by the key-lookup wrapper when the key source itself failed (as opposed to the token being unacceptable). */
class KeySourceFailure extends Error {
  constructor(readonly original: unknown) {
    super('key source failure');
  }
}

/**
 * Key-selection errors that are caused by the token (unknown kid, unsupported or disallowed algorithm, malformed JWS).
 * Anything else the key getter throws (timeout, network failure, non-200 or non-JSON answer, invalid key set) means the
 * IdP's key endpoint is broken, which is not the caller's fault.
 */
const isTokenCausedKeyError = (error: unknown): boolean =>
  error instanceof errors.JWKSNoMatchingKey ||
  error instanceof errors.JWKSMultipleMatchingKeys ||
  error instanceof errors.JOSENotSupported ||
  error instanceof errors.JWSInvalid ||
  error instanceof errors.JOSEAlgNotAllowed;

function tagKeySourceFailures(keys: JWTVerifyGetKey): JWTVerifyGetKey {
  return async (protectedHeader, token) => {
    try {
      return await keys(protectedHeader, token);
    } catch (error) {
      if (isTokenCausedKeyError(error)) throw error;
      throw new KeySourceFailure(error);
    }
  };
}

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: AccessTokenVerifierOptions) {
    this.keys = tagKeySourceFailures(options.keys);
  }

  async verify(token: string, now: Date): Promise<VerifiedAccessToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: [...this.options.allowedAlgs],
        clockTolerance: this.options.clockToleranceSec,
        currentDate: now,
        requiredClaims: ['sub', 'exp', 'iat'],
      }));
    } catch (error) {
      if (error instanceof KeySourceFailure) {
        // The IdP's key endpoint is unreachable or broken and no cached key matched: not the caller's fault.
        throw new DependencyUnavailableError('identity-provider-jwks');
      }
      if (error instanceof errors.JOSEError) {
        throw new AuthenticationError('invalid_token', `${error.code}: ${error.message}`);
      }
      throw new AuthenticationError('invalid_token', `token could not be verified: ${String(error)}`);
    }

    const nowSec = Math.floor(now.getTime() / 1000);
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + this.options.clockToleranceSec) {
      throw new AuthenticationError('invalid_token', 'token iat is in the future');
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
