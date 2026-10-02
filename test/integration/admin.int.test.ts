import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SequenceRandomSource } from '../support/sequence-random.js';
import { TestContext, type ApiClient } from '../support/test-context.js';

const random = new SequenceRandomSource();
let ctx: TestContext;
let alice: ApiClient;
let bob: ApiClient;
let admin: ApiClient;

beforeAll(async () => {
  ctx = await TestContext.create({
    env: { PAYMENT_FAILURE_RATE: '0.5' },
    overrides: { paymentRandom: random },
  });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
  alice = await ctx.login({ sub: 'alice', roles: ['user'] });
  bob = await ctx.login({ sub: 'bob', roles: ['user'] });
  admin = await ctx.login({ sub: 'root', roles: ['user', 'admin'] });
});

const dataOf = (res: request.Response): unknown => (res.body as { data: unknown }).data;
const listOf = (res: request.Response): Record<string, unknown>[] =>
  (res.body as { data: Record<string, unknown>[] }).data;
interface Metrics {
  usage: { tokens: { total: number } };
}

const ADMIN_GETS = ['/api/v1/admin/metrics', '/api/v1/admin/chat/messages', '/api/v1/admin/subscriptions'];

describe('admin API', () => {
  it('is forbidden to plain users at the controller level', async () => {
    for (const path of ADMIN_GETS) {
      const res = await alice.get(path);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('reports usage and subscription metrics', async () => {
    for (let i = 0; i < 3; i += 1) await alice.post('/api/v1/chat/messages', { question: `q${i}` });
    await alice.post('/api/v1/subscriptions', { tier: 'PRO', billingCycle: 'YEARLY', autoRenew: true });
    await alice.post('/api/v1/chat/messages', { question: 'paid' });
    await bob.post('/api/v1/chat/messages', { question: 'bob' });
    random.queue(0.1);
    expect(
      (
        await bob.post('/api/v1/subscriptions', {
          tier: 'BASIC',
          billingCycle: 'MONTHLY',
          autoRenew: false,
        })
      ).status,
    ).toBe(402);

    const res = await admin.get('/api/v1/admin/metrics');
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      generatedAt: '2026-10-15T12:00:00.000Z',
      usage: { period: '2026-10', messages: { total: 5, free: 4, paid: 1, failed: 0 }, activeUsers: 2 },
      subscriptions: {
        activeByTier: { BASIC: 0, PRO: 1, ENTERPRISE: 0 },
        activeByCycle: { MONTHLY: 0, YEARLY: 1 },
        autoRenewEnabled: 1,
        inactiveByReason: { PAYMENT_FAILED: 1, CANCELLED: 0, EXPIRED: 0 },
      },
      payments: { thisMonth: { succeeded: 1, failed: 1, revenueCents: 29990 } },
    });
    expect((dataOf(res) as Metrics).usage.tokens.total).toBeGreaterThan(0);
  });

  it('lists every user’s messages and subscriptions, filterable by user', async () => {
    await alice.post('/api/v1/chat/messages', { question: 'from alice' });
    await bob.post('/api/v1/chat/messages', { question: 'from bob' });
    await alice.post('/api/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const all = await admin.get('/api/v1/admin/chat/messages');
    expect(listOf(all)).toHaveLength(2);
    const aliceId = (dataOf(await alice.get('/api/v1/auth/me')) as { userId: string }).userId;
    const bobId = (dataOf(await bob.get('/api/v1/auth/me')) as { userId: string }).userId;
    // Each item names its owner, so an unfiltered system-wide listing is still attributable.
    expect(listOf(all).map((m) => `${String(m.userId)} ${String(m.question)}`)).toEqual(
      expect.arrayContaining([`${aliceId} from alice`, `${bobId} from bob`]),
    );
    const onlyBob = await admin.get(`/api/v1/admin/chat/messages?userId=${bobId}`);
    expect(listOf(onlyBob).map((m) => m.question)).toEqual(['from bob']);
    const subs = await admin.get('/api/v1/admin/subscriptions?status=ACTIVE');
    expect(listOf(subs)).toHaveLength(1);
    expect(listOf(subs)[0]).toMatchObject({ userId: aliceId, tier: 'BASIC' });
    expect((await admin.get('/api/v1/admin/chat/messages?userId=not-a-uuid')).status).toBe(400);
  });
});
