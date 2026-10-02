import request from 'supertest';
import { inject } from 'vitest';
import { buildContainer, type Container, type ContainerOverrides } from '../../src/bootstrap.js';
import type { AppConfig } from '../../src/shared/infrastructure/config/env.js';
import { createLogger } from '../../src/shared/infrastructure/logging/logger.js';
import { truncateAll } from './db.js';
import { DpopTestClient } from './dpop-client.js';
import { FakeClock } from './fake-clock.js';
import { captureLogs } from './log-capture.js';
import { MockIdp } from './mock-idp.js';
import { testConfig } from './test-config.js';

export interface TestUser {
  sub: string;
  roles?: string[];
  email?: string | null;
  sessionId?: string | null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class ApiClient {
  constructor(
    private readonly ctx: TestContext,
    readonly dpop: DpopTestClient,
    readonly accessToken: string,
  ) {}

  /** Sends a request with `Authorization: DPoP <token>` and a fresh proof (unless one is supplied). */
  async send(
    method: Method,
    path: string,
    options: { body?: unknown; proof?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<request.Response> {
    const proof =
      options.proof ??
      (await this.dpop.proof({
        method,
        url: this.ctx.url(path),
        accessToken: this.accessToken,
        now: this.ctx.clock.now(),
      }));
    const agent = request(this.ctx.app);
    const call =
      method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path)
          : method === 'PATCH'
            ? agent.patch(path)
            : agent.delete(path);
    call.set('Authorization', `DPoP ${this.accessToken}`).set('DPoP', proof);
    for (const [name, value] of Object.entries(options.headers ?? {})) call.set(name, value);
    // Client-side timeout: supertest aborts the connection, which the server sees as a client disconnect.
    if (options.timeoutMs !== undefined) call.timeout(options.timeoutMs);
    return options.body === undefined ? call : call.send(options.body as object);
  }

  get(path: string): Promise<request.Response> {
    return this.send('GET', path);
  }
  post(path: string, body?: unknown): Promise<request.Response> {
    return this.send('POST', path, { body });
  }
  patch(path: string, body: unknown): Promise<request.Response> {
    return this.send('PATCH', path, { body });
  }
  delete(path: string): Promise<request.Response> {
    return this.send('DELETE', path);
  }
}

/** Real app, real Postgres/Redis (Testcontainers), mock IdP serving a real JWKS over HTTP, fake clock. */
export class TestContext {
  static readonly START = '2026-10-15T12:00:00.000Z';

  private constructor(
    readonly container: Container,
    readonly idp: MockIdp,
    readonly clock: FakeClock,
    readonly logs: ReturnType<typeof captureLogs>,
  ) {}

  static async create(
    options: { env?: Record<string, string>; overrides?: ContainerOverrides } = {},
  ): Promise<TestContext> {
    const idp = await MockIdp.create();
    const jwksUri = await idp.startServer();
    const clock = new FakeClock(TestContext.START);
    const logs = captureLogs();
    const config = testConfig({
      DATABASE_URL: inject('databaseAppUrl'),
      REDIS_URL: inject('redisUrl'),
      OIDC_ISSUER: idp.issuer,
      OIDC_JWKS_URI: jwksUri,
      ...options.env,
    });
    const container = await buildContainer(config, {
      clock,
      userCacheTtlMs: 0,
      logger: createLogger({ level: 'info', pretty: false, destination: logs.stream }),
      ...options.overrides,
    });
    return new TestContext(container, idp, clock, logs);
  }

  get app(): Container['app'] {
    return this.container.app;
  }

  get config(): AppConfig {
    return this.container.config;
  }

  url(path: string): string {
    return `${this.config.publicBaseUrl}${path.split('?')[0] ?? path}`;
  }

  /** Empty tables, flush Redis (rate limits, replay cache, revocations) and rewind the clock. */
  async reset(): Promise<void> {
    await truncateAll(inject('databaseOwnerUrl'));
    await this.container.redis.flushdb();
    this.clock.set(TestContext.START);
  }

  async close(): Promise<void> {
    await this.container.close();
    await this.idp.stop();
  }

  tokenFor(user: TestUser, dpop: DpopTestClient): Promise<string> {
    return this.idp.issueAccessToken({
      subject: user.sub,
      roles: user.roles,
      email: user.email,
      sessionId: user.sessionId,
      jkt: dpop.jkt,
      now: this.clock.now(),
    });
  }

  async login(user: TestUser): Promise<ApiClient> {
    const dpop = await DpopTestClient.create();
    return new ApiClient(this, dpop, await this.tokenFor(user, dpop));
  }
}
