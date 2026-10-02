import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { requestContext } from '../../../../src/shared/infrastructure/logging/request-context.js';

function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('adds requestId and userId from the request context', () => {
    const out = capture();
    const logger = createLogger({ level: 'info', pretty: false, destination: out.stream });
    requestContext.run({ requestId: 'req-12345678', userId: 'user-1' }, () => {
      logger.info({ event: 'x' }, 'hello');
    });
    logger.info({}, 'outside');
    const [inside, outside] = out.lines();
    expect(inside).toMatchObject({ requestId: 'req-12345678', userId: 'user-1', event: 'x', msg: 'hello' });
    expect(outside).not.toHaveProperty('requestId');
  });

  it('redacts credentials in request headers', () => {
    const out = capture();
    const logger = createLogger({ level: 'info', pretty: false, destination: out.stream });
    logger.info({ req: { headers: { authorization: 'DPoP abc', dpop: 'proof', cookie: 'c=1' } } }, 'req');
    const [line] = out.lines();
    expect(JSON.stringify(line)).not.toMatch(/abc|proof|c=1/);
  });
});
