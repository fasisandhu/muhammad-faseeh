import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../../../src/shared/http/error-handler.js';
import { requestId } from '../../../../src/shared/http/request-id.js';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';

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
