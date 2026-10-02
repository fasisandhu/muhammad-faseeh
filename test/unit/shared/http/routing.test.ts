import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Actor, type Role } from '../../../../src/shared/domain/actor.js';
import { createErrorHandler } from '../../../../src/shared/http/error-handler.js';
import { requestId } from '../../../../src/shared/http/request-id.js';
import { defineRoute, mountRoutes, type Route } from '../../../../src/shared/http/routing.js';
import { requestTimeout } from '../../../../src/shared/http/timeout.js';
import { paginationQuery, uuidParam } from '../../../../src/shared/http/validation.js';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { sanitizedText } from '../../../../src/shared/http/sanitize.js';

/** Component test: stands in for the authentication middleware so the router can be tested alone. */
function appWith(routes: Route[], roles: Role[] | null) {
  const app = express();
  app.use(requestId(), requestTimeout(5000), express.json());
  app.use((_req, res, next) => {
    if (roles) {
      res.locals.auth = {
        actor: new Actor('user-1', 'sub-1', roles),
        email: null,
        token: { id: 't', sessionId: 's', expiresAt: new Date(), keyThumbprint: 'k' },
      };
    }
    next();
  });
  const router = express.Router();
  mountRoutes(router, routes);
  app.use(router);
  app.use(createErrorHandler(createLogger({ level: 'silent', pretty: false }), { dpopAlgs: ['ES256'] }));
  return app;
}

const echo = defineRoute({
  method: 'post',
  path: '/echo',
  summary: 'test',
  access: { roles: ['user'] },
  schemas: { body: z.strictObject({ question: sanitizedText(100) }) },
  handler: ({ body, actor }) =>
    Promise.resolve({ status: 201, body: { data: { question: body.question, by: actor.userId } } }),
});
const adminOnly = defineRoute({
  method: 'get',
  path: '/admin-thing',
  summary: 'test',
  access: { roles: ['admin'] },
  handler: () => Promise.resolve({ status: 200, body: { data: 'secret' } }),
});
const listing = defineRoute({
  method: 'get',
  path: '/items/:id',
  summary: 'test',
  access: { roles: ['user'] },
  schemas: { params: uuidParam, query: paginationQuery },
  handler: ({ params, query }) =>
    Promise.resolve({ status: 200, body: { data: { id: params.id, limit: query.limit } } }),
});
const noContent = defineRoute({
  method: 'delete',
  path: '/thing',
  summary: 'test',
  access: { roles: ['user'] },
  handler: () => Promise.resolve({ status: 204 }),
});

const routes = [echo, adminOnly, listing, noContent];
const id = '7f1c9b5e-3a2d-4c8e-9f10-112233445566';

describe('route registry', () => {
  it('runs the handler with validated, sanitised input', async () => {
    const res = await request(appWith(routes, ['user']))
      .post('/echo')
      .send({ question: '<b>Hi</b>' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { question: 'Hi', by: 'user-1' } });
  });

  it('enforces declared roles at the controller level', async () => {
    const res = await request(appWith(routes, ['user'])).get('/admin-thing');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    expect((await request(appWith(routes, ['user', 'admin'])).get('/admin-thing')).status).toBe(200);
  });

  it('refuses to run without an authenticated principal (defence in depth)', async () => {
    const res = await request(appWith(routes, null)).get('/admin-thing');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^DPoP /);
  });

  it.each([
    ['unknown field (mass assignment)', { question: 'hi', userId: 'someone-else' }],
    ['wrong type', { question: ['a'] }],
    ['missing field', {}],
  ])('rejects bodies with %s', async (_name, body) => {
    const res = await request(appWith(routes, ['user']))
      .post('/echo')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body).toMatchObject({ details: { issues: expect.any(Array) as unknown } });
  });

  it('rejects bodies and query strings a route does not declare', async () => {
    const app = appWith(routes, ['user', 'admin']);
    expect((await request(app).get('/admin-thing').query({ debug: '1' })).status).toBe(400);
    expect((await request(app).delete('/thing').send({ force: true })).status).toBe(400);
  });

  it('validates params and query, including duplicated parameters', async () => {
    const app = appWith(routes, ['user']);
    expect((await request(app).get(`/items/${id}?limit=5`)).body).toEqual({ data: { id, limit: 5 } });
    expect((await request(app).get('/items/not-a-uuid')).status).toBe(400);
    expect((await request(app).get(`/items/${id}?limit=10&limit=20`)).status).toBe(400);
    expect((await request(app).get(`/items/${id}?limit=1000`)).status).toBe(400);
    expect((await request(app).get(`/items/${id}?cursor=%%%`)).status).toBe(400);
  });

  it('sends empty bodies for 204', async () => {
    const res = await request(appWith(routes, ['user'])).delete('/thing');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('refuses to define a route without roles', () => {
    expect(() =>
      defineRoute({
        method: 'get',
        path: '/open',
        summary: 'x',
        access: { roles: [] },
        handler: () => Promise.resolve({ status: 200 }),
      }),
    ).toThrow(/at least one role/);
  });
});
