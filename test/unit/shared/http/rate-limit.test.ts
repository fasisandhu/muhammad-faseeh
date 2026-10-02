import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../../../src/shared/http/error-handler.js';
import {
  authFailureRetryAfter,
  createRateLimiters,
  globalIpLimiter,
  recordAuthFailure,
  resolveRateLimitGroup,
} from '../../../../src/shared/http/rate-limit.js';
import { requestId } from '../../../../src/shared/http/request-id.js';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { testConfig } from '../../../support/test-config.js';

const logger = createLogger({ level: 'silent', pretty: false });

describe('resolveRateLimitGroup', () => {
  it.each([
    ['/v1/auth/me', 'auth'],
    ['/v1/chat/messages', 'chat'],
    ['/v1/subscriptions/abc/cancellation', 'subscriptions'],
    ['/v1/subscription-plans', 'subscriptions'],
    ['/v1/admin/metrics', 'admin'],
    ['/v1/chatty', 'auth'],
    ['/v2/anything', 'auth'],
  ])('%s -> %s', (path, group) => {
    expect(resolveRateLimitGroup(path)).toBe(group);
  });
});

describe('global per-IP limiter (memory store)', () => {
  it('returns 429 with Retry-After and RateLimit headers once the budget is spent', async () => {
    const limits = testConfig({ RATE_LIMIT_GLOBAL_IP_PER_MIN: '2' }).rateLimits;
    const app = express()
      .use(requestId(), globalIpLimiter(createRateLimiters(null, limits), logger))
      .get('/x', (_req, res) => {
        res.json({ ok: true });
      })
      .use(createErrorHandler(logger, { dpopAlgs: ['ES256'] }));
    const first = await request(app).get('/x');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');
    await request(app).get('/x');
    const blocked = await request(app).get('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED', details: { group: 'global', scope: 'ip' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('auth failure budget', () => {
  it('blocks an IP after too many failed authentications', async () => {
    const limits = testConfig({ RATE_LIMIT_AUTH_FAILURES_PER_IP: '2' }).rateLimits;
    const set = createRateLimiters(null, limits);
    expect(await authFailureRetryAfter(set, '10.0.0.1')).toBeNull();
    await recordAuthFailure(set, '10.0.0.1');
    await recordAuthFailure(set, '10.0.0.1');
    expect(await authFailureRetryAfter(set, '10.0.0.1')).toBeGreaterThan(0);
    expect(await authFailureRetryAfter(set, '10.0.0.2')).toBeNull();
  });
});
