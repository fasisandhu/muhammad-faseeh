import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../../src/shared/domain/errors.js';
import { createErrorHandler } from '../../../../src/shared/http/error-handler.js';
import { requestId } from '../../../../src/shared/http/request-id.js';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { captureLogs } from '../../../support/log-capture.js';

const logger = createLogger({ level: 'silent', pretty: false });

const appThrowing = (error: unknown) =>
  express()
    .use(requestId())
    .get('/boom', () => {
      throw error;
    })
    .use(createErrorHandler(logger, { dpopAlgs: ['ES256'] }));

describe('error handler body-parser error mapping', () => {
  it('maps known body-parser error types', async () => {
    const res = await request(appThrowing({ type: 'entity.too.large' })).get('/boom');
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'does not treat inherited property "%s" as a body-parser error type',
    async (type) => {
      const res = await request(appThrowing({ type })).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    },
  );
});

describe('error handler dependency failures', () => {
  it('answers a generic 503 and keeps the dependency name in the server log only', async () => {
    const logs = captureLogs();
    const app = express()
      .use(requestId())
      .get('/boom', () => {
        throw new DependencyUnavailableError('redis');
      })
      .use(
        createErrorHandler(createLogger({ level: 'info', pretty: false, destination: logs.stream }), {
          dpopAlgs: ['ES256'],
        }),
      );

    const res = await request(app).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      detail: 'A required dependency is temporarily unavailable.',
    });
    expect(res.body).not.toHaveProperty('details');
    expect(res.text).not.toContain('redis');
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: 'request rejected', code: 'SERVICE_UNAVAILABLE', dependency: 'redis' }),
    );
  });
});
