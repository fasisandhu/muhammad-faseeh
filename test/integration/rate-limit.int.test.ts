import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/test-context.js';

describe('per-user and per-IP limits per endpoint group', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create({
      env: {
        RATE_LIMIT_CHAT_USER_PER_MIN: '3',
        RATE_LIMIT_CHAT_IP_PER_MIN: '1000',
        RATE_LIMIT_SUBSCRIPTIONS_USER_PER_MIN: '2',
        RATE_LIMIT_AUTH_USER_PER_MIN: '2',
        RATE_LIMIT_AUTH_IP_PER_MIN: '4',
      },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('limits each user per group and reports it with standard headers', async () => {
    const alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    for (let i = 0; i < 3; i += 1) {
      const ok = await alice.get('/api/v1/chat/usage');
      expect(ok.status).toBe(200);
      expect(ok.headers['ratelimit-limit']).toBeDefined();
    }
    const blocked = await alice.get('/api/v1/chat/usage');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { group: 'chat', scope: 'user' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });

  it('keeps groups and users independent', async () => {
    const alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    const bob = await ctx.login({ sub: 'bob', roles: ['user'] });
    for (let i = 0; i < 4; i += 1) await alice.get('/api/v1/chat/usage');
    expect((await alice.get('/api/v1/chat/usage')).status).toBe(429);
    expect((await alice.get('/api/v1/subscription-plans')).status).toBe(200);
    expect((await bob.get('/api/v1/chat/usage')).status).toBe(200);
  });

  it('applies the stricter auth-group limits', async () => {
    const alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    expect((await alice.get('/api/v1/auth/me')).status).toBe(200);
    expect((await alice.get('/api/v1/auth/me')).status).toBe(200);
    expect((await alice.get('/api/v1/auth/me')).status).toBe(429);
  });

  it('limits an IP across users before authentication runs', async () => {
    const users = await Promise.all(['a', 'b', 'c'].map((sub) => ctx.login({ sub, roles: ['user'] })));
    const statuses: number[] = [];
    for (const user of users) {
      statuses.push((await user.get('/api/v1/auth/me')).status, (await user.get('/api/v1/auth/me')).status);
    }
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses.slice(4)).toEqual([429, 429]);
    const anonymous = await request(ctx.app).get('/api/v1/auth/me');
    expect(anonymous.status).toBe(429);
    expect(anonymous.body).toMatchObject({ details: { group: 'auth', scope: 'ip' } });
  });
});

describe('global per-IP limit', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create({ env: { RATE_LIMIT_GLOBAL_IP_PER_MIN: '5' } });
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('throttles every route, including health and unknown paths', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await request(ctx.app).get('/nowhere')).status);
    expect(statuses).toEqual([404, 404, 404, 404, 404, 429]);
  });
});
