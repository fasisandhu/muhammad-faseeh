import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerQuery } from '../support/owner-db.js';
import { TestContext } from '../support/test-context.js';

describe('quota deduction under concurrency', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('serves exactly 3 free + 10 bundle messages to 25 parallel requests', async () => {
    const alice = await ctx.login({ sub: 'alice', roles: ['user'] });
    const buy = await alice.post('/api/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    expect(buy.status).toBe(201);

    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        alice.post('/api/v1/chat/messages', { question: `parallel ${i}` }),
      ),
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(13);
    expect(statuses.filter((status) => status === 402)).toHaveLength(12);

    const [usage] = await ownerQuery<{ free_used: number; paid_used: number }>(
      'SELECT free_used, paid_used FROM monthly_usage',
    );
    expect(usage).toEqual({ free_used: 3, paid_used: 10 });
    const [subscription] = await ownerQuery<{ used_messages: number }>(
      'SELECT used_messages FROM subscriptions',
    );
    expect(subscription?.used_messages).toBe(10);
    const [completed] = await ownerQuery<{ n: string }>(
      "SELECT count(*) AS n FROM chat_messages WHERE status = 'COMPLETED'",
    );
    expect(Number(completed?.n)).toBe(13);
  });
});
