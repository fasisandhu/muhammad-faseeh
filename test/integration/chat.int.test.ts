import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmClient } from '../../src/modules/chat/index.js';
import { ownerQuery } from '../support/owner-db.js';
import { TestContext, type ApiClient } from '../support/test-context.js';

interface MessageDto {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  model: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  charge: { source: string; period: string; subscriptionId?: string };
  failureCode: string | null;
  requestId: string;
  createdAt: string;
}
interface QuotaDto {
  period: string;
  free: { limit: number; used: number; remaining: number; resetsAt: string };
  paidUsed: number;
  totalTokens: number;
  bundles: { subscriptionId: string; tier: string; remainingMessages: number | null }[];
}
interface Problem {
  code: string;
  details?: { bundles?: unknown };
}

const asked = (res: request.Response): { message: MessageDto; quota: QuotaDto } =>
  (res.body as { data: { message: MessageDto; quota: QuotaDto } }).data;
const one = (res: request.Response): MessageDto => (res.body as { data: MessageDto }).data;
const quotaOf = (res: request.Response): QuotaDto => (res.body as { data: QuotaDto }).data;
const pageOf = (res: request.Response): { data: MessageDto[]; page: { nextCursor: string | null } } =>
  res.body as { data: MessageDto[]; page: { nextCursor: string | null } };
const problem = (res: request.Response): Problem => res.body as Problem;
const header = (res: request.Response, name: string): unknown => res.headers[name];

const ask = (client: ApiClient, question = 'What is DPoP?') =>
  client.post('/api/v1/chat/messages', { question });
const buy = async (client: ApiClient, tier: 'BASIC' | 'PRO' | 'ENTERPRISE') => {
  const res = await client.post('/api/v1/subscriptions', { tier, billingCycle: 'MONTHLY', autoRenew: true });
  expect(res.status).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

describe('chat with the mocked model', () => {
  let ctx: TestContext;
  let alice: ApiClient;
  let bob: ApiClient;
  let admin: ApiClient;

  beforeAll(async () => {
    ctx = await TestContext.create();
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

  it('stores question, answer, token usage and request metadata for free messages', async () => {
    let tokens = 0;
    for (let i = 1; i <= 3; i += 1) {
      const res = await ask(alice, `Question ${i}`);
      expect(res.status).toBe(201);
      const { message, quota } = asked(res);
      expect(message).toMatchObject({
        question: `Question ${i}`,
        status: 'COMPLETED',
        model: 'gpt-4o-mini',
        charge: { source: 'FREE', period: '2026-10' },
        requestId: header(res, 'x-request-id'),
        createdAt: '2026-10-15T12:00:00.000Z',
      });
      expect(message.answer).toContain(`Question ${i}`);
      expect(quota.free.remaining).toBe(3 - i);
      tokens += message.usage?.totalTokens ?? 0;
    }
    const rows = await ownerQuery<{ answer: string | null; total_tokens: number; request_id: string }>(
      'SELECT answer, total_tokens, request_id FROM chat_messages',
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.answer !== null && row.total_tokens > 0 && row.request_id.length > 0),
    ).toBe(true);
    const [usage] = await ownerQuery<{ free_used: number; paid_used: number; total_tokens: string }>(
      'SELECT free_used, paid_used, total_tokens FROM monthly_usage',
    );
    expect(usage).toMatchObject({ free_used: 3, paid_used: 0 });
    expect(Number(usage?.total_tokens)).toBe(tokens);
  });

  it('answers a typed 402 once the free quota is used and records nothing', async () => {
    for (let i = 0; i < 3; i += 1) await ask(alice);
    const res = await ask(alice);
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      details: {
        period: '2026-10',
        free: { limit: 3, used: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
        bundles: { active: 0, withRemaining: 0 },
      },
    });
    expect(await ownerQuery('SELECT id FROM chat_messages')).toHaveLength(3);
  });

  it('charges a bundle after the free quota and stops when the bundle is empty', async () => {
    const basic = await buy(alice, 'BASIC');
    for (let i = 0; i < 3; i += 1) expect(asked(await ask(alice)).message.charge.source).toBe('FREE');
    for (let i = 0; i < 10; i += 1) {
      const res = await ask(alice);
      expect(asked(res).message.charge).toEqual({
        source: 'BUNDLE',
        period: '2026-10',
        subscriptionId: basic,
      });
    }
    const exhausted = await ask(alice);
    expect(exhausted.status).toBe(402);
    expect(problem(exhausted).details?.bundles).toEqual({ active: 1, withRemaining: 0 });
  });

  it('deducts from the most recently started bundle first', async () => {
    const basic = await buy(alice, 'BASIC');
    ctx.clock.advance(1000);
    alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    const pro = await buy(alice, 'PRO');
    for (let i = 0; i < 3; i += 1) await ask(alice);
    expect(asked(await ask(alice)).message.charge.subscriptionId).toBe(pro);
    const used = async (id: string) =>
      (
        (await alice.get(`/api/v1/subscriptions/${id}`)).body as {
          data: { usedMessages: number };
        }
      ).data.usedMessages;
    expect(await used(pro)).toBe(1);
    expect(await used(basic)).toBe(0);
  });

  it('never runs out on Enterprise', async () => {
    await buy(alice, 'ENTERPRISE');
    for (let i = 0; i < 18; i += 1) expect((await ask(alice)).status).toBe(201);
    const usage = quotaOf(await alice.get('/api/v1/chat/usage'));
    expect(usage).toMatchObject({ free: { used: 3, remaining: 0 }, paidUsed: 15 });
    expect(usage.bundles[0]).toMatchObject({ tier: 'ENTERPRISE', remainingMessages: null });
  });

  it('resets the free quota on the 1st of the month (UTC)', async () => {
    for (let i = 0; i < 3; i += 1) await ask(alice);
    expect((await ask(alice)).status).toBe(402);
    ctx.clock.set('2026-11-01T00:00:00.000Z');
    alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    const res = await ask(alice);
    expect(res.status).toBe(201);
    expect(asked(res).message.charge).toEqual({ source: 'FREE', period: '2026-11' });
  });

  it('lists own messages newest first, reads one, and hides other users’ messages', async () => {
    await ask(alice, 'first');
    ctx.clock.advance(1000);
    alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    const second = await ask(alice, 'second');
    await ask(bob, 'bob only');
    const page = await alice.get('/api/v1/chat/messages?limit=1');
    expect(pageOf(page).data.map((m) => m.question)).toEqual(['second']);
    const next = await alice.get(
      `/api/v1/chat/messages?limit=1&cursor=${pageOf(page).page.nextCursor ?? ''}`,
    );
    expect(pageOf(next).data.map((m) => m.question)).toEqual(['first']);
    const id = asked(second).message.id;
    expect(one(await alice.get(`/api/v1/chat/messages/${id}`)).question).toBe('second');
    expect((await bob.get(`/api/v1/chat/messages/${id}`)).status).toBe(404);
    expect((await admin.get(`/api/v1/chat/messages/${id}`)).status).toBe(200);
  });

  it('strips markup and stores SQL-looking text verbatim', async () => {
    const xss = await ask(alice, '<script>alert(1)</script><b>What</b> is RAG?');
    expect(asked(xss).message.question).toBe('What is RAG?');
    const sql = await ask(alice, "Robert'); DROP TABLE chat_messages; --");
    expect(sql.status).toBe(201);
    expect(asked(sql).message.question).toBe("Robert'); DROP TABLE chat_messages; --");
    expect(await ownerQuery('SELECT id FROM chat_messages')).toHaveLength(2);
  });

  it.each([
    ['an array question', { question: ['a'] }],
    ['a numeric question', { question: 42 }],
    ['an extra field', { question: 'hi', userId: '7f1c9b5e-3a2d-4c8e-9f10-112233445566' }],
    ['markup only', { question: '<script>alert(1)</script>' }],
    ['4001 characters', { question: 'a'.repeat(4001) }],
  ])('rejects %s with 400 and charges nothing', async (_name, body) => {
    const res = await alice.post('/api/v1/chat/messages', body);
    expect(res.status).toBe(400);
    expect(problem(res).code).toBe('VALIDATION_FAILED');
    expect(await ownerQuery('SELECT * FROM monthly_usage')).toHaveLength(0);
  });

  it('refunds reservations abandoned by a crashed request', async () => {
    const me = await alice.get('/api/v1/auth/me');
    const userId = (me.body as { data: { userId: string } }).data.userId;
    await ownerQuery("INSERT INTO monthly_usage (user_id, period, free_used) VALUES ($1, '2026-10', 1)", [
      userId,
    ]);
    await ownerQuery(
      `INSERT INTO chat_messages (id, user_id, question, status, charge_kind, charge_period, request_id, created_at)
       VALUES (gen_random_uuid(), $1, 'lost', 'PENDING', 'FREE', '2026-10', 'crashed-request', $2)`,
      [userId, new Date('2026-10-15T11:55:00.000Z')],
    );
    const sweeper = ctx.container.jobs.find((job) => job.name === 'chat-reservation-sweeper');
    expect(await sweeper?.run()).toEqual({ refunded: 1 });
    const [message] = await ownerQuery<{ status: string; failure_code: string }>(
      'SELECT status, failure_code FROM chat_messages',
    );
    expect(message).toEqual({ status: 'FAILED', failure_code: 'ABANDONED' });
    const [usage] = await ownerQuery<{ free_used: number }>('SELECT free_used FROM monthly_usage');
    expect(usage?.free_used).toBe(0);
  });
});

describe('failed model calls are never charged', () => {
  const behaviour: { mode: 'fail' | 'hang' | 'rollover' } = { mode: 'fail' };
  let ctx: TestContext;
  let alice: ApiClient;

  const llm: LlmClient = {
    async complete({ signal }) {
      if (behaviour.mode === 'rollover') ctx.clock.set('2026-11-01T00:00:01.000Z');
      if (behaviour.mode === 'hang') {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        });
      }
      throw new Error('upstream down');
    },
  };

  beforeAll(async () => {
    // FREE_MESSAGES_PER_MONTH=0: every message is charged to a bundle, so bundle refunds are exercised too.
    ctx = await TestContext.create({
      env: { FREE_MESSAGES_PER_MONTH: '0', LLM_TIMEOUT_MS: '300' },
      overrides: { llmClient: llm },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    behaviour.mode = 'fail';
    alice = await ctx.login({ sub: 'alice', roles: ['user'] });
  });

  const usedMessages = async (id: string) =>
    (
      await ownerQuery<{ used_messages: number }>('SELECT used_messages FROM subscriptions WHERE id = $1', [
        id,
      ])
    )[0]?.used_messages;

  it('refunds the bundle and records the failure when the model errors (502)', async () => {
    const id = await buy(alice, 'BASIC');
    const res = await ask(alice);
    expect(res.status).toBe(502);
    expect(problem(res).code).toBe('LLM_UNAVAILABLE');
    expect(await usedMessages(id)).toBe(0);
    const [message] = await ownerQuery<{ status: string; failure_code: string }>(
      'SELECT status, failure_code FROM chat_messages',
    );
    expect(message).toEqual({ status: 'FAILED', failure_code: 'LLM_UNAVAILABLE' });
  });

  it('times out slow model calls (504) and refunds', async () => {
    behaviour.mode = 'hang';
    const id = await buy(alice, 'BASIC');
    const res = await ask(alice);
    expect(res.status).toBe(504);
    expect(problem(res).code).toBe('LLM_TIMEOUT');
    expect(await usedMessages(id)).toBe(0);
  });

  it('refunds when the client disconnects mid-request', async () => {
    behaviour.mode = 'hang';
    const id = await buy(alice, 'BASIC');
    await expect(
      alice.send('POST', '/api/v1/chat/messages', { body: { question: 'bye' }, timeoutMs: 100 }),
    ).rejects.toThrow();
    await expect
      .poll(
        async () =>
          (await ownerQuery<{ failure_code: string | null }>('SELECT failure_code FROM chat_messages'))[0]
            ?.failure_code,
        { timeout: 3000 },
      )
      .toBe('REQUEST_ABORTED');
    expect(await usedMessages(id)).toBe(0);
  });

  it('refunds into the month that was charged even if the month rolls over (Review Focus 4)', async () => {
    const id = await buy(alice, 'BASIC');
    ctx.clock.set('2026-10-31T23:59:59.000Z');
    alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    behaviour.mode = 'rollover';
    expect((await ask(alice)).status).toBe(502);
    const rows = await ownerQuery<{ period: string; paid_used: number }>(
      'SELECT period, paid_used FROM monthly_usage ORDER BY period',
    );
    expect(rows).toEqual([{ period: '2026-10', paid_used: 0 }]);
    expect(await usedMessages(id)).toBe(0);
  });
});
