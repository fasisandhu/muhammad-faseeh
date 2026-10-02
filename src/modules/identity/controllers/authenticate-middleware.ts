import type { Request, RequestHandler } from 'express';
import type { Logger } from '../../../shared/application/logger.js';
import { pathOf } from '../../../shared/http/path.js';
import { HttpError } from '../../../shared/http/problem.js';
import {
  authFailureRetryAfter,
  clientIp,
  recordAuthFailure,
  type RateLimiterSet,
} from '../../../shared/http/rate-limit.js';
import { bindUserToLogContext } from '../../../shared/http/request-id.js';
import type { AuthenticateRequest } from '../application/authenticate-request.js';
import { AuthenticationError } from '../domain/errors.js';

/** RFC 9110 §11.1: the auth scheme is case-insensitive; the token is token68. */
const DPOP_AUTHORIZATION = /^dpop ([A-Za-z0-9\-._~+/]+=*)$/i;

function readCredentials(req: Request): { accessToken: string; proof: string } {
  const authorization = req.get('authorization');
  if (authorization === undefined) throw new AuthenticationError('missing', 'no Authorization header');
  const match = DPOP_AUTHORIZATION.exec(authorization);
  if (!match?.[1]) {
    const reason = authorization.startsWith('Bearer ')
      ? 'Bearer scheme is not accepted; use DPoP'
      : 'malformed Authorization header';
    throw new AuthenticationError('invalid_token', reason);
  }
  const proof = req.headers.dpop;
  if (proof === undefined) throw new AuthenticationError('invalid_dpop_proof', 'missing DPoP header');
  if (Array.isArray(proof) || proof.includes(',')) {
    throw new AuthenticationError('invalid_dpop_proof', 'exactly one DPoP header is required');
  }
  return { accessToken: match[1], proof };
}

/** Runs for every /api request before route matching. Failures count against the IP's auth-failure budget. */
export function authenticateMiddleware(deps: {
  authenticate: AuthenticateRequest;
  limiters: RateLimiterSet;
  publicBaseUrl: string;
  logger: Logger;
}): RequestHandler {
  return async (req, res, next) => {
    const ip = clientIp(req);
    const retryAfter = await authFailureRetryAfter(deps.limiters, ip);
    if (retryAfter !== null) {
      next(
        new HttpError(
          'RATE_LIMITED',
          `Too many failed authentication attempts. Retry in ${retryAfter} s.`,
          { group: 'auth-failures', scope: 'ip', retryAfterSeconds: retryAfter },
          { 'Retry-After': String(retryAfter) },
        ),
      );
      return;
    }
    try {
      const { accessToken, proof } = readCredentials(req);
      const auth = await deps.authenticate.execute({
        accessToken,
        proof,
        method: req.method,
        url: `${deps.publicBaseUrl}${pathOf(req)}`,
      });
      res.locals.auth = auth;
      bindUserToLogContext(auth.actor.userId);
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        await recordAuthFailure(deps.limiters, ip);
        deps.logger.warn({ challenge: error.challenge, reason: error.reason, ip }, 'authentication failed');
      }
      next(error);
    }
  };
}
