import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/shared/infrastructure/logging/logger.js';
import { createErrorHandler } from '../../src/shared/http/error-handler.js';
import { createRateLimiters } from '../../src/shared/http/rate-limit.js';
import { requestId } from '../../src/shared/http/request-id.js';
import { requestTimeout } from '../../src/shared/http/timeout.js';
import { captureLogs } from '../support/log-capture.js';
import { HEALTH_TOKEN, testConfig } from '../support/test-config.js';

const healthy = { database: () => Promise.resolve(), redis: () => Promise.resolve() };

function build(options: { db?: () => Promise<void> } = {}) {
  const logs = captureLogs();
  const logger = createLogger({ level: 'info', pretty: false, destination: logs.stream });
  const config = testConfig();
  const app = createApp({
    config,
    logger,
    health: { ...healthy, database: options.db ?? healthy.database },
    rateLimiters: createRateLimiters(null, config.rateLimits),
  });
  return { app, logs };
}

const expectProblem = (res: request.Response, status: number, code: string) => {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({
    status,
    code,
    type: expect.stringMatching(/^urn:ggi:problem:/) as unknown,
  });
  expect(res.body).toMatchObject({ requestId: res.headers['x-request-id'] });
  expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/); // no stack traces
};

describe('security middleware', () => {
  it('sets hardened response headers on every response', async () => {
    const res = await request(build().app).get('/health/live').set('X-Health-Token', HEALTH_TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('protects health endpoints with the probe token', async () => {
    const { app } = build();
    expectProblem(await request(app).get('/health/live'), 401, 'UNAUTHENTICATED');
    expectProblem(
      await request(app).get('/health/live').set('X-Health-Token', 'wrong'),
      401,
      'UNAUTHENTICATED',
    );
    const ready = await request(app).get('/health/ready').set('X-Health-Token', HEALTH_TOKEN);
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });

  it('reports a degraded dependency with 503', async () => {
    const { app } = build({ db: () => Promise.reject(new Error('down')) });
    const res = await request(app).get('/health/ready').set('X-Health-Token', HEALTH_TOKEN);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', checks: { database: 'down', redis: 'up' } });
  });

  it('echoes safe request ids and replaces unsafe ones', async () => {
    const { app } = build();
    const safe = await request(app).get('/nope').set('X-Request-Id', 'client-req-123');
    expect(safe.headers['x-request-id']).toBe('client-req-123');
    const unsafe = await request(app).get('/nope').set('X-Request-Id', '<script>alert(1)</script>');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows preflight only from configured origins', async () => {
    const { app } = build();
    const ok = await request(app)
      .options('/api/v1/chat/messages')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(ok.headers['access-control-allow-headers']).toContain('DPoP');
    expectProblem(
      await request(app).options('/api/v1/chat/messages').set('Origin', 'https://evil.example.com'),
      403,
      'CORS_ORIGIN_DENIED',
    );
    expectProblem(await request(app).get('/health/live').set('Origin', 'null'), 403, 'CORS_ORIGIN_DENIED');
  });

  it('rejects bodies that are not JSON', async () => {
    const { app } = build();
    expectProblem(
      await request(app).post('/health/live').set('Content-Type', 'text/plain').send('hello'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectProblem(
      await request(app)
        .post('/health/live')
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{}'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('rejects oversized and malformed bodies', async () => {
    const { app } = build();
    const big = JSON.stringify({ question: 'x'.repeat(20_000) });
    expectProblem(
      await request(app).post('/health/live').set('Content-Type', 'application/json').send(big),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    expectProblem(
      await request(app).post('/health/live').set('Content-Type', 'application/json').send('{"a":'),
      400,
      'MALFORMED_JSON',
    );
  });

  it('rejects unacceptable Accept headers and overlong URLs', async () => {
    const { app } = build();
    expectProblem(await request(app).get('/nope').set('Accept', 'text/html'), 406, 'NOT_ACCEPTABLE');
    expectProblem(await request(app).get(`/nope?q=${'a'.repeat(2100)}`), 414, 'URI_TOO_LONG');
  });

  it('answers unknown routes with a problem document', async () => {
    const res = await request(build().app).get('/does-not-exist');
    expectProblem(res, 404, 'ROUTE_NOT_FOUND');
    expect(res.body).toMatchObject({ instance: '/does-not-exist' });
  });

  it('writes one structured log line per request', async () => {
    const { app, logs } = build();
    await request(app)
      .get('/health/live')
      .set('X-Health-Token', HEALTH_TOKEN)
      .set('X-Request-Id', 'log-check-1234');
    const line = logs.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({ requestId: 'log-check-1234', res: { statusCode: 200 } });
    expect(typeof line?.responseTimeMs).toBe('number');
    expect(JSON.stringify(logs.lines())).not.toContain(HEALTH_TOKEN);
  });

  it('times out slow requests and aborts their work', async () => {
    let aborted = false;
    const app = express()
      .use(requestId(), requestTimeout(100))
      .get('/slow', async (_req, res) => {
        res.locals.abortSignal.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!res.headersSent) res.json({ late: true });
      })
      .use(createErrorHandler(createLogger({ level: 'silent', pretty: false }), { dpopAlgs: ['ES256'] }));
    const res = await request(app).get('/slow');
    expectProblem(res, 503, 'REQUEST_TIMEOUT');
    expect(aborted).toBe(true);
  });
});
