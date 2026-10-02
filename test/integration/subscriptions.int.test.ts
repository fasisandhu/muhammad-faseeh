import pg from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
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

const buy = (client: ApiClient, body: Record<string, unknown> = {}) =>
  client.post('/api/v1/subscriptions', {
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    autoRenew: true,
    ...body,
  });

interface Dto {
  id: string;
  tier: string;
  [key: string]: unknown;
}
const one = (res: request.Response): Dto => (res.body as { data: Dto }).data;
const many = (res: request.Response): Dto[] => (res.body as { data: Dto[] }).data;
const nextCursor = (res: request.Response): string | null =>
  (res.body as { page: { nextCursor: string | null } }).page.nextCursor;
const problem = (res: request.Response): { code: string; details?: Record<string, unknown> } =>
  res.body as { code: string; details?: Record<string, unknown> };
const idOf = async (pending: Promise<request.Response>): Promise<string> => one(await pending).id;

async function paymentRows(): Promise<{ kind: string; status: string }[]> {
  const client = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
  await client.connect();
  try {
    return (await client.query<{ kind: string; status: string }>('SELECT kind, status FROM payments')).rows;
  } finally {
    await client.end();
  }
}

describe('subscription plans', () => {
  it('lists the six plans with server-side prices and limits', async () => {
    const res = await alice.get('/api/v1/subscription-plans');
    expect(res.status).toBe(200);
    expect(many(res)).toHaveLength(6);
    expect(many(res)).toContainEqual({
      tier: 'PRO',
      billingCycle: 'YEARLY',
      maxMessages: 1200,
      unlimited: false,
      price: { amountCents: 29990, currency: 'USD' },
    });
  });
});

describe('creating subscriptions', () => {
  it('creates an active bundle with every required field', async () => {
    const res = await buy(alice);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/subscriptions/${one(res).id}`);
    expect(one(res)).toMatchObject({
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      maxMessages: 10,
      usedMessages: 0,
      remainingMessages: 10,
      price: { amountCents: 999, currency: 'USD' },
      status: 'ACTIVE',
      inactiveReason: null,
      autoRenew: true,
      startDate: '2026-10-15T12:00:00.000Z',
      endDate: '2026-11-15T12:00:00.000Z',
      renewalDate: '2026-11-15T12:00:00.000Z',
    });
    expect(await paymentRows()).toEqual([{ kind: 'INITIAL', status: 'SUCCEEDED' }]);
  });

  it('keeps a declined purchase as an inactive record and answers 402', async () => {
    random.queue(0.1); // below the 0.5 failure rate → declined
    const res = await buy(alice);
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'PAYMENT_FAILED', details: { reason: 'card_declined' } });
    const list = await alice.get('/api/v1/subscriptions');
    expect(many(list)).toHaveLength(1);
    expect(many(list)[0]).toMatchObject({
      id: problem(res).details?.subscriptionId,
      status: 'INACTIVE',
      inactiveReason: 'PAYMENT_FAILED',
      renewalDate: null,
      autoRenew: false,
    });
    expect(many(list)[0]?.endDate).toBe(many(list)[0]?.startDate);
    expect(await paymentRows()).toEqual([{ kind: 'INITIAL', status: 'FAILED' }]);
  });

  it.each([
    ['a client-chosen price', { price: 0 }],
    ['a client-chosen limit', { maxMessages: 1_000_000 }],
    ['another user id', { userId: '7f1c9b5e-3a2d-4c8e-9f10-112233445566' }],
    ['a client-chosen status', { status: 'ACTIVE' }],
    ['a string boolean', { autoRenew: 'true' }],
    ['a lower-case tier', { tier: 'basic' }],
    ['an unknown tier', { tier: 'PLATINUM' }],
  ])('rejects %s (mass assignment / strict types)', async (_name, override) => {
    const res = await buy(alice, override);
    expect(res.status).toBe(400);
    expect(problem(res).code).toBe('VALIDATION_FAILED');
  });
});

describe('reading subscriptions', () => {
  it('lists only the caller’s subscriptions, newest first, with cursor pagination', async () => {
    await buy(alice, { tier: 'BASIC' });
    ctx.clock.advance(1000);
    await buy(alice, { tier: 'PRO' });
    await buy(bob);
    const first = await alice.get('/api/v1/subscriptions?limit=1');
    expect(many(first).map((s) => s.tier)).toEqual(['PRO']);
    expect(nextCursor(first)).toEqual(expect.any(String));
    const second = await alice.get(`/api/v1/subscriptions?limit=1&cursor=${nextCursor(first)!}`);
    expect(many(second).map((s) => s.tier)).toEqual(['BASIC']);
    expect(nextCursor(second)).toBeNull();
  });

  it('filters by status and rejects duplicated or out-of-range query parameters', async () => {
    await buy(alice);
    expect(many(await alice.get('/api/v1/subscriptions?status=INACTIVE'))).toHaveLength(0);
    expect((await alice.get('/api/v1/subscriptions?limit=10&limit=20')).status).toBe(400);
    expect((await alice.get('/api/v1/subscriptions?limit=0')).status).toBe(400);
    expect((await alice.get('/api/v1/subscriptions?status=active')).status).toBe(400);
  });

  it('hides other users’ subscriptions behind 404, but admins can read them', async () => {
    const id = await idOf(buy(alice));
    for (const res of [
      await bob.get(`/api/v1/subscriptions/${id}`),
      await bob.patch(`/api/v1/subscriptions/${id}`, { autoRenew: false }),
      await bob.post(`/api/v1/subscriptions/${id}/cancellation`),
    ]) {
      expect(res.status).toBe(404);
      expect(problem(res).code).toBe('NOT_FOUND');
    }
    expect((await admin.get(`/api/v1/subscriptions/${id}`)).status).toBe(200);
  });
});

describe('managing subscriptions', () => {
  it('toggles auto-renew together with the renewal date', async () => {
    const id = await idOf(buy(alice));
    const off = await alice.patch(`/api/v1/subscriptions/${id}`, { autoRenew: false });
    expect(one(off)).toMatchObject({ autoRenew: false, renewalDate: null });
    const on = await alice.patch(`/api/v1/subscriptions/${id}`, { autoRenew: true });
    expect(one(on)).toMatchObject({ autoRenew: true, renewalDate: '2026-11-15T12:00:00.000Z' });
    expect((await alice.patch(`/api/v1/subscriptions/${id}`, { autoRenew: true, tier: 'PRO' })).status).toBe(
      400,
    );
  });

  it('cancels immediately, blocks further changes and keeps history', async () => {
    const id = await idOf(buy(alice));
    ctx.clock.advanceDays(3);
    alice = await ctx.login({ sub: 'alice', roles: ['user'] }); // access tokens live 5 minutes
    const res = await alice.post(`/api/v1/subscriptions/${id}/cancellation`);
    expect(res.status).toBe(200);
    expect(one(res)).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      autoRenew: false,
      renewalDate: null,
      endDate: '2026-10-18T12:00:00.000Z',
      cancelledAt: '2026-10-18T12:00:00.000Z',
    });
    const again = await alice.post(`/api/v1/subscriptions/${id}/cancellation`);
    expect(again.status).toBe(409);
    expect(problem(again).code).toBe('SUBSCRIPTION_NOT_ACTIVE');
    expect((await alice.patch(`/api/v1/subscriptions/${id}`, { autoRenew: true })).status).toBe(409);
    expect(await paymentRows()).toHaveLength(1);
  });
});
