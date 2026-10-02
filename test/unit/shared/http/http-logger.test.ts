import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { httpLogger } from '../../../../src/shared/http/http-logger.js';
import { requestId } from '../../../../src/shared/http/request-id.js';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { captureLogs } from '../../../support/log-capture.js';

function rawLines(chunks: string[]): string[] {
  return chunks
    .join('')
    .split('\n')
    .filter((line) => line.includes('request completed'));
}

describe('httpLogger requestId', () => {
  it('falls back to res.locals.requestId when the request async context is gone', async () => {
    const logs = captureLogs();
    const logger = createLogger({ level: 'info', pretty: false, destination: logs.stream });
    const app = express()
      .use((_req, res, next) => {
        res.locals.requestId = 'outside-context-1';
        next();
      })
      .use(httpLogger(logger))
      .get('/x', (_req, res) => {
        res.json({ ok: true });
      });
    await request(app).get('/x');
    const line = logs.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({ requestId: 'outside-context-1' });
  });

  it('does not emit a duplicate requestId key when the context is live', async () => {
    const chunks: string[] = [];
    const { Writable } = await import('node:stream');
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ level: 'info', pretty: false, destination: stream });
    const app = express()
      .use(requestId(), httpLogger(logger))
      .get('/x', (_req, res) => {
        res.json({ ok: true });
      });
    await request(app).get('/x').set('X-Request-Id', 'inside-context-1');
    const [line] = rawLines(chunks);
    expect(line).toBeDefined();
    expect(line?.match(/"requestId"/g)).toHaveLength(1);
  });
});
