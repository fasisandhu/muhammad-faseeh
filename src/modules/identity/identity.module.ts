import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { createRemoteJWKSet } from 'jose';
import type { Logger } from '../../shared/application/logger.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { AppConfig } from '../../shared/infrastructure/config/env.js';
import type { DbContext } from '../../shared/infrastructure/db/context.js';
import type { RateLimiterSet } from '../../shared/http/rate-limit.js';
import type { Route } from '../../shared/http/routing.js';
import { AuthenticateRequest } from './application/authenticate-request.js';
import { Logout } from './application/logout.js';
import { ProvisionUser } from './application/provision-user.js';
import { authenticateMiddleware } from './controllers/authenticate-middleware.js';
import { authRoutes } from './controllers/auth-routes.js';
import { JoseAccessTokenVerifier } from './infrastructure/access-token-verifier.js';
import { JoseDpopProofVerifier } from './infrastructure/dpop-proof-verifier.js';
import { RedisReplayCache } from './infrastructure/redis-replay-cache.js';
import { RedisSessionRevocations } from './infrastructure/redis-session-revocations.js';
import { DrizzleUserRepository } from './repositories/user-repository.js';

export interface IdentityModuleDeps {
  config: AppConfig;
  db: DbContext;
  redis: Redis;
  clock: Clock;
  logger: Logger;
  limiters: RateLimiterSet;
  userCacheTtlMs?: number;
}

export interface IdentityModule {
  authenticate: RequestHandler;
  routes: Route[];
}

export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const { config } = deps;
  const tokens = new JoseAccessTokenVerifier({
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    allowedAlgs: config.oidc.allowedAlgs,
    clockToleranceSec: config.oidc.clockToleranceSec,
    rolesClaim: config.oidc.rolesClaim,
    keys: createRemoteJWKSet(new URL(config.oidc.jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    }),
  });
  const proofs = new JoseDpopProofVerifier({
    allowedAlgs: config.dpop.allowedAlgs,
    maxAgeSec: config.dpop.maxAgeSec,
    clockSkewSec: config.dpop.clockSkewSec,
    replayCache: new RedisReplayCache(deps.redis),
  });
  const revocations = new RedisSessionRevocations(deps.redis);
  const provision = new ProvisionUser(new DrizzleUserRepository(deps.db), deps.clock, {
    cacheTtlMs: deps.userCacheTtlMs ?? 5 * 60_000,
  });
  const authenticate = new AuthenticateRequest({ tokens, proofs, revocations, provision, clock: deps.clock });
  const logout = new Logout(revocations, config.session.revocationTtlSec * 1000);
  return {
    authenticate: authenticateMiddleware({
      authenticate,
      limiters: deps.limiters,
      publicBaseUrl: config.publicBaseUrl,
      logger: deps.logger,
    }),
    routes: authRoutes({ logout }),
  };
}
