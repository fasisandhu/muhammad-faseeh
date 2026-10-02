import type { Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import type { AppConfig } from '../infrastructure/config/env.js';
import { HttpError } from './problem.js';

export const RATE_LIMIT_GROUPS = ['auth', 'chat', 'subscriptions', 'admin'] as const;
export type RateLimitGroup = (typeof RATE_LIMIT_GROUPS)[number];

export interface RateLimiterSet {
  global: RateLimiterAbstract;
  ip: Record<RateLimitGroup, RateLimiterAbstract>;
  user: Record<RateLimitGroup, RateLimiterAbstract>;
  authFailures: RateLimiterAbstract;
}

/** Redis-backed (shared across instances) with an in-memory insurance limiter if Redis is unreachable. */
function limiter(
  redis: Redis | null,
  keyPrefix: string,
  points: number,
  duration: number,
): RateLimiterAbstract {
  const memory = new RateLimiterMemory({ keyPrefix, points, duration });
  if (redis === null) return memory;
  return new RateLimiterRedis({ storeClient: redis, keyPrefix, points, duration, insuranceLimiter: memory });
}

export function createRateLimiters(redis: Redis | null, limits: AppConfig['rateLimits']): RateLimiterSet {
  const perGroup = (scope: 'ip' | 'user'): Record<RateLimitGroup, RateLimiterAbstract> => ({
    auth: limiter(
      redis,
      `rl:auth:${scope}`,
      scope === 'ip' ? limits.auth.ipPerMin : limits.auth.userPerMin,
      60,
    ),
    chat: limiter(
      redis,
      `rl:chat:${scope}`,
      scope === 'ip' ? limits.chat.ipPerMin : limits.chat.userPerMin,
      60,
    ),
    subscriptions: limiter(
      redis,
      `rl:subscriptions:${scope}`,
      scope === 'ip' ? limits.subscriptions.ipPerMin : limits.subscriptions.userPerMin,
      60,
    ),
    admin: limiter(
      redis,
      `rl:admin:${scope}`,
      scope === 'ip' ? limits.admin.ipPerMin : limits.admin.userPerMin,
      60,
    ),
  });
  return {
    global: limiter(redis, 'rl:global:ip', limits.globalIpPerMin, 60),
    ip: perGroup('ip'),
    user: perGroup('user'),
    authFailures: limiter(
      redis,
      'rl:auth-failures:ip',
      limits.authFailures.perIp,
      limits.authFailures.windowSec,
    ),
  };
}

const PREFIXES: readonly [string, RateLimitGroup][] = [
  ['/v1/auth', 'auth'],
  ['/v1/chat', 'chat'],
  ['/v1/subscriptions', 'subscriptions'],
  ['/v1/subscription-plans', 'subscriptions'],
  ['/v1/admin', 'admin'],
];

/** Path is relative to /api. Unknown paths get the strictest group so scanning is throttled. */
export function resolveRateLimitGroup(path: string): RateLimitGroup {
  const match = PREFIXES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match ? match[1] : 'auth';
}

export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

function setHeaders(res: Response, limit: number, result: RateLimiterRes): void {
  const remaining = Math.max(0, result.remainingPoints);
  const current = Number(res.getHeader('RateLimit-Remaining'));
  if (Number.isFinite(current) && current <= remaining) return; // keep the most restrictive limiter's numbers
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
}

function limit(
  logger: Logger,
  pick: (
    req: Request,
    res: Response,
  ) => { limiter: RateLimiterAbstract; key: string | null; group: string; scope: 'ip' | 'user' },
): RequestHandler {
  return async (req, res, next) => {
    const { limiter: selected, key, group, scope } = pick(req, res);
    if (key === null) {
      next();
      return;
    }
    try {
      setHeaders(res, selected.points, await selected.consume(key));
      next();
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        const retryAfterSeconds = Math.max(1, Math.ceil(rejection.msBeforeNext / 1000));
        setHeaders(res, selected.points, rejection);
        next(
          new HttpError(
            'RATE_LIMITED',
            `Too many requests. Retry in ${retryAfterSeconds} s.`,
            { group, scope, retryAfterSeconds },
            { 'Retry-After': String(retryAfterSeconds) },
          ),
        );
        return;
      }
      // Store error with no insurance left: fail open for availability, loudly.
      logger.error({ err: rejection, group, scope }, 'rate limiter unavailable');
      next();
    }
  };
}

export const globalIpLimiter = (set: RateLimiterSet, logger: Logger): RequestHandler =>
  limit(logger, (req) => ({ limiter: set.global, key: clientIp(req), group: 'global', scope: 'ip' }));

export const groupIpLimiter = (set: RateLimiterSet, logger: Logger): RequestHandler =>
  limit(logger, (req) => {
    const group = resolveRateLimitGroup(req.path);
    return { limiter: set.ip[group], key: clientIp(req), group, scope: 'ip' };
  });

export const groupUserLimiter = (set: RateLimiterSet, logger: Logger): RequestHandler =>
  limit(logger, (req, res) => {
    const group = resolveRateLimitGroup(req.path);
    return { limiter: set.user[group], key: res.locals.auth?.actor.userId ?? null, group, scope: 'user' };
  });

/** Seconds until this IP may try to authenticate again, or null when it is not blocked. */
export async function authFailureRetryAfter(set: RateLimiterSet, ip: string): Promise<number | null> {
  try {
    const state = await set.authFailures.get(ip);
    if (state === null || state.consumedPoints < set.authFailures.points) return null;
    return Math.max(1, Math.ceil(state.msBeforeNext / 1000));
  } catch {
    return null;
  }
}

export async function recordAuthFailure(set: RateLimiterSet, ip: string): Promise<void> {
  try {
    await set.authFailures.consume(ip);
  } catch {
    // Already over budget (RateLimiterRes) or store error: nothing more to record.
  }
}
