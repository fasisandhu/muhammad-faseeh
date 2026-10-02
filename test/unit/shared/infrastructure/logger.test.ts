import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../src/shared/infrastructure/logging/logger.js';
import { requestContext } from '../../../../src/shared/infrastructure/logging/request-context.js';
import { captureLogs } from '../../../support/log-capture.js';

describe('createLogger', () => {
  it('adds requestId and userId from the request context', () => {
    const out = captureLogs();
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
    const out = captureLogs();
    const logger = createLogger({ level: 'info', pretty: false, destination: out.stream });
    logger.info({ req: { headers: { authorization: 'DPoP abc', dpop: 'proof', cookie: 'c=1' } } }, 'req');
    const [line] = out.lines();
    expect(JSON.stringify(line)).not.toMatch(/abc|proof|c=1/);
  });
});
