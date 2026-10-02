import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Router } from 'express';
import { HttpError } from './problem.js';

export interface HealthChecks {
  database(): Promise<void>;
  redis(): Promise<void>;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

async function probe(check: () => Promise<void>, timeoutMs: number): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('health probe timed out'));
        }, timeoutMs);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Liveness and readiness, protected by a machine credential because the spec forbids open endpoints. */
export function healthRouter(options: {
  token: string;
  checks: HealthChecks;
  probeTimeoutMs?: number;
}): Router {
  const expected = digest(options.token);
  const probeTimeoutMs = options.probeTimeoutMs ?? 1000;
  const router = express.Router();
  router.use((req, _res, next) => {
    const provided = digest(req.get('x-health-token') ?? '');
    next(
      timingSafeEqual(provided, expected)
        ? undefined
        : new HttpError('UNAUTHENTICATED', 'A valid X-Health-Token header is required.'),
    );
  });
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  router.get('/ready', async (_req, res) => {
    const [database, redis] = await Promise.all([
      probe(() => options.checks.database(), probeTimeoutMs),
      probe(() => options.checks.redis(), probeTimeoutMs),
    ]);
    const ready = database === 'up' && redis === 'up';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks: { database, redis } });
  });
  return router;
}
