import pg from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { SequenceRandomSource } from '../support/sequence-random.js';
import { TestContext, type ApiClient } from '../support/test-context.js';

const random = new SequenceRandomSource();
let ctx: TestContext;
let alice: ApiClient;
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
  admin = await ctx.login({ sub: 'root', roles: ['user', 'admin'] });
});

async function ownerQuery<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

interface Summary {
  processed: number;
  renewed: number;
  paymentFailed: number;
  expired: number;
}
const summaryOf = (res: request.Response): Summary => (res.body as { data: Summary }).data;
const dataOf = (res: request.Response): Record<string, unknown> =>
  (res.body as { data: Record<string, unknown> }).data;

const buy = async (autoRenew = true): Promise<string> => {
  const res = await alice.post('/api/v1/subscriptions', {
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    autoRenew,
  });
  expect(res.status).toBe(201);
  return dataOf(res).id as string;
};

/** Admin tokens are short-lived; re-login after moving the clock so the token is valid "now". */
const runBilling = async () => {
  admin = await ctx.login({ sub: 'root', roles: ['user', 'admin'] });
  return admin.post('/api/v1/admin/billing-runs');
};
const readAsAlice = async (id: string) => {
  alice = await ctx.login({ sub: 'alice', roles: ['user'] });
  return dataOf(await alice.get(`/api/v1/subscriptions/${id}`));
};

describe('billing runs', () => {
  it('is an admin-only operation', async () => {
    const res = await alice.post('/api/v1/admin/billing-runs');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does nothing before anything is due', async () => {
    await buy();
    ctx.clock.advanceDays(10);
    expect(summaryOf(await runBilling())).toEqual({
      processed: 0,
      renewed: 0,
      paymentFailed: 0,
      expired: 0,
    });
  });

  it('renews into the next period and resets usage when the payment succeeds', async () => {
    const id = await buy();
    await ownerQuery('UPDATE subscriptions SET used_messages = 5 WHERE id = $1', [id]);
    ctx.clock.advanceDays(31);
    random.queue(0.9);
    expect(summaryOf(await runBilling())).toEqual({
      processed: 1,
      renewed: 1,
      paymentFailed: 0,
      expired: 0,
    });
    expect(await readAsAlice(id)).toMatchObject({
      status: 'ACTIVE',
      usedMessages: 0,
      renewalCount: 1,
      currentPeriodStart: '2026-11-15T12:00:00.000Z',
      endDate: '2026-12-15T12:00:00.000Z',
      renewalDate: '2026-12-15T12:00:00.000Z',
    });
    const rows = await ownerQuery<{ kind: string; status: string }>(
      'SELECT kind, status FROM payments ORDER BY attempted_at',
    );
    expect(rows).toEqual([
      { kind: 'INITIAL', status: 'SUCCEEDED' },
      { kind: 'RENEWAL', status: 'SUCCEEDED' },
    ]);
  });

  it('marks the subscription inactive when the renewal payment fails', async () => {
    const id = await buy();
    ctx.clock.advanceDays(31);
    random.queue(0.1);
    expect(summaryOf(await runBilling())).toMatchObject({ processed: 1, paymentFailed: 1 });
    expect(await readAsAlice(id)).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'PAYMENT_FAILED',
      renewalDate: null,
    });
  });

  it('expires subscriptions without auto-renew at the end of their period', async () => {
    const id = await buy(false);
    ctx.clock.advanceDays(31);
    expect(summaryOf(await runBilling())).toMatchObject({ processed: 1, expired: 1 });
    expect(await readAsAlice(id)).toMatchObject({ status: 'INACTIVE', inactiveReason: 'EXPIRED' });
  });

  it('never renews cancelled subscriptions', async () => {
    const id = await buy();
    expect((await alice.post(`/api/v1/subscriptions/${id}/cancellation`)).status).toBe(200);
    ctx.clock.advanceDays(40);
    expect(summaryOf(await runBilling()).processed).toBe(0);
  });

  it('catches up on several missed periods, one payment per period', async () => {
    const id = await buy();
    ctx.clock.advanceDays(65);
    random.queue(0.9, 0.9);
    expect(summaryOf(await runBilling())).toMatchObject({ processed: 2, renewed: 2 });
    expect(await readAsAlice(id)).toMatchObject({ renewalCount: 2, endDate: '2027-01-15T12:00:00.000Z' });
  });

  it('lets concurrent runs share the work without double charging (SKIP LOCKED)', async () => {
    for (let i = 0; i < 5; i += 1) await buy();
    ctx.clock.advanceDays(31);
    admin = await ctx.login({ sub: 'root', roles: ['user', 'admin'] });
    const [a, b] = await Promise.all([
      admin.post('/api/v1/admin/billing-runs'),
      admin.post('/api/v1/admin/billing-runs'),
    ]);
    expect(summaryOf(a).renewed + summaryOf(b).renewed).toBe(5);
    const [{ n }] = (await ownerQuery<{ n: string }>(
      "SELECT count(*) AS n FROM payments WHERE kind = 'RENEWAL'",
    )) as [{ n: string }];
    expect(Number(n)).toBe(5);
  });
});
