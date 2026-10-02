import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestContext } from '../support/test-context.js';

const SAMPLE_ID = '7f1c9b5e-3a2d-4c8e-9f10-112233445566';

describe('route inventory: no open or bypassable endpoints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('registers the expected API surface', () => {
    const surface = ctx.container.routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(surface).toEqual(
      [
        'GET /admin/chat/messages',
        'GET /admin/metrics',
        'GET /admin/subscriptions',
        'GET /auth/me',
        'GET /chat/messages',
        'GET /chat/messages/:id',
        'GET /chat/usage',
        'GET /subscription-plans',
        'GET /subscriptions',
        'GET /subscriptions/:id',
        'PATCH /subscriptions/:id',
        'POST /admin/billing-runs',
        'POST /auth/logout',
        'POST /chat/messages',
        'POST /subscriptions',
        'POST /subscriptions/:id/cancellation',
      ].sort(),
    );
  });

  it('rejects every route without credentials', async () => {
    for (const route of ctx.container.routes) {
      const path = `/api/v1${route.path.replace(':id', SAMPLE_ID)}`;
      const res = await request(ctx.app)
        [route.method](path)
        .send(route.method === 'get' ? undefined : {});
      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(401);
    }
  });

  it('restricts every /admin route to the admin role and nothing else', () => {
    for (const route of ctx.container.routes.filter((r) => r.path.startsWith('/admin'))) {
      expect(route.access.roles).toEqual(['admin']);
    }
  });

  it('protects the health endpoints with the probe token', async () => {
    expect((await request(ctx.app).get('/health/live')).status).toBe(401);
    expect((await request(ctx.app).get('/health/ready')).status).toBe(401);
  });
});
