import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { DpopTestClient } from '../support/dpop-client.js';
import { ApiClient, TestContext } from '../support/test-context.js';

const alice = { sub: 'alice', roles: ['user'] };

const json = (res: request.Response): Record<string, unknown> => res.body as Record<string, unknown>;
const data = (res: request.Response): Record<string, unknown> => json(res).data as Record<string, unknown>;

async function emailOf(subject: string): Promise<string | null | undefined> {
  const client = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
  await client.connect();
  try {
    const { rows } = await client.query<{ email: string | null }>(
      'SELECT email FROM users WHERE idp_subject = $1',
      [subject],
    );
    return rows[0]?.email;
  } finally {
    await client.end();
  }
}

describe('authenticated API access', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  const expect401 = (res: request.Response, challenge?: string) => {
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(json(res).code).toBe('UNAUTHENTICATED');
    const header = String(res.headers['www-authenticate']);
    expect(header).toMatch(/^DPoP /);
    if (challenge) expect(header).toContain(`error="${challenge}"`);
  };

  it('requires credentials, even for paths that do not exist', async () => {
    expect401(await request(ctx.app).get('/api/v1/auth/me'));
    expect401(await request(ctx.app).get('/api/v1/definitely-not-a-route'));
  });

  it('accepts a DPoP-bound token with a fresh proof and provisions the user', async () => {
    const client = await ctx.login(alice);
    const res = await client.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({
      subject: 'alice',
      email: 'alice@example.com',
      roles: ['user'],
      keyThumbprint: client.dpop.jkt,
    });
    expect(data(res).userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await emailOf('alice')).toBe('alice@example.com');
  });

  it('accepts users without an email claim', async () => {
    const client = await ctx.login({ sub: 'github-private', roles: ['user'], email: null });
    const res = await client.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(data(res).email).toBeNull();
    expect(await emailOf('github-private')).toBeNull();
  });

  it('logs the user id with the request', async () => {
    const client = await ctx.login(alice);
    const res = await client.get('/api/v1/auth/me');
    const line = ctx.logs
      .lines()
      .find((l) => l.msg === 'request completed' && l.requestId === res.headers['x-request-id']);
    expect(line).toMatchObject({ userId: data(res).userId, route: '/api/v1/auth/me' });
  });

  it('rejects the Bearer scheme: possession of the token is not enough', async () => {
    const client = await ctx.login(alice);
    const res = await request(ctx.app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${client.accessToken}`);
    expect401(res, 'invalid_token');
  });

  it('rejects a stolen token used without the private key', async () => {
    const victim = await ctx.login(alice);
    const attacker = await DpopTestClient.create();
    const proof = await attacker.proof({
      method: 'GET',
      url: ctx.url('/api/v1/auth/me'),
      accessToken: victim.accessToken,
      now: ctx.clock.now(),
    });
    expect401(await victim.send('GET', '/api/v1/auth/me', { proof }), 'invalid_dpop_proof');
  });

  it('rejects a replayed proof', async () => {
    const client = await ctx.login(alice);
    const proof = await client.dpop.proof({
      method: 'GET',
      url: ctx.url('/api/v1/auth/me'),
      accessToken: client.accessToken,
      now: ctx.clock.now(),
    });
    expect((await client.send('GET', '/api/v1/auth/me', { proof })).status).toBe(200);
    expect401(await client.send('GET', '/api/v1/auth/me', { proof }), 'invalid_dpop_proof');
  });

  it('rejects proofs for another URL or method, and stale proofs', async () => {
    const client = await ctx.login(alice);
    const at = ctx.clock.now();
    const token = client.accessToken;
    const otherUrl = await client.dpop.proof({
      method: 'GET',
      url: ctx.url('/api/v1/chat/usage'),
      accessToken: token,
      now: at,
    });
    const otherMethod = await client.dpop.proof({
      method: 'POST',
      url: ctx.url('/api/v1/auth/me'),
      accessToken: token,
      now: at,
    });
    const stale = await client.dpop.proof({
      method: 'GET',
      url: ctx.url('/api/v1/auth/me'),
      accessToken: token,
      now: at,
      iatOffsetSec: -120,
    });
    for (const proof of [otherUrl, otherMethod, stale]) {
      expect401(await client.send('GET', '/api/v1/auth/me', { proof }), 'invalid_dpop_proof');
    }
  });

  it.each([
    ['a wrong issuer', { iss: 'http://evil.test/realms/ggi' }],
    ['a wrong audience', { aud: 'ggi-cli' }],
  ])('rejects tokens with %s', async (_name, claims) => {
    const dpop = await DpopTestClient.create();
    const token = await ctx.idp.issueAccessToken({
      subject: 'alice',
      now: ctx.clock.now(),
      jkt: dpop.jkt,
      claims,
    });
    const client = new ApiClient(ctx, dpop, token);
    expect401(await client.get('/api/v1/auth/me'), 'invalid_token');
  });

  it('rejects expired, forged and unbound tokens', async () => {
    const dpop = await DpopTestClient.create();
    const now = ctx.clock.now();
    const expired = await ctx.idp.issueAccessToken({
      subject: 'alice',
      now: new Date(now.getTime() - 3_600_000),
      jkt: dpop.jkt,
    });
    const forged = await ctx.idp.issueAccessToken({ subject: 'alice', now, jkt: dpop.jkt, signer: 'rogue' });
    const unbound = await ctx.idp.issueAccessToken({ subject: 'alice', now, jkt: null });
    const base = await ctx.login(alice);
    for (const token of [expired, forged, unbound]) {
      const proof = await dpop.proof({
        method: 'GET',
        url: ctx.url('/api/v1/auth/me'),
        accessToken: token,
        now,
      });
      const res = await request(ctx.app)
        .get('/api/v1/auth/me')
        .set('Authorization', `DPoP ${token}`)
        .set('DPoP', proof);
      expect401(res, 'invalid_token');
    }
    expect((await base.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('kills every token of a session on logout', async () => {
    const client = await ctx.login({ ...alice, sessionId: 'session-1' });
    expect((await client.post('/api/v1/auth/logout')).status).toBe(204);
    expect401(await client.get('/api/v1/auth/me'), 'invalid_token');
    const otherSession = await ctx.login({ ...alice, sessionId: 'session-2' });
    expect((await otherSession.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('forbids tokens that carry no application role', async () => {
    const client = await ctx.login({ sub: 'nobody', roles: ['offline_access'] });
    const res = await client.get('/api/v1/auth/me');
    expect(res.status).toBe(403);
    expect(json(res).code).toBe('FORBIDDEN');
  });

  it('answers 404 only to authenticated callers', async () => {
    const client = await ctx.login(alice);
    const res = await client.get('/api/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(json(res).code).toBe('ROUTE_NOT_FOUND');
  });

  it('keeps verifying with cached keys while the IdP is unreachable', async () => {
    const client = await ctx.login(alice);
    expect((await client.get('/api/v1/auth/me')).status).toBe(200);
    await ctx.idp.stop();
    expect((await client.get('/api/v1/auth/me')).status).toBe(200);
  });
});

describe('garbage authentication headers', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it.each([
    ['DPoP without a token', { Authorization: 'DPoP' }],
    ['double space', { Authorization: 'DPoP  abc.def.ghi', DPoP: 'abc' }],
    ['lower-case scheme junk', { Authorization: 'dpop abc' }],
    ['non-JWT proof', { Authorization: 'DPoP abc.def.ghi', DPoP: 'not-a-jwt' }],
    ['10 KB token', { Authorization: `DPoP ${'a'.repeat(10_240)}`, DPoP: 'x.y.z' }],
    ['Basic credentials', { Authorization: 'Basic YWxpY2U6c2VjcmV0' }],
  ])('answers 401 problem+json for %s', async (_name, headers) => {
    const res = await request(ctx.app).get('/api/v1/auth/me').set(headers);
    expect(res.status).toBe(401);
    expect(json(res).code).toBe('UNAUTHENTICATED');
  });

  it('rejects two DPoP headers', async () => {
    const client = await ctx.login(alice);
    const proof = await client.dpop.proof({
      method: 'GET',
      url: ctx.url('/api/v1/auth/me'),
      accessToken: client.accessToken,
      now: ctx.clock.now(),
    });
    const res = await request(ctx.app)
      .get('/api/v1/auth/me')
      .set('Authorization', `DPoP ${client.accessToken}`)
      .set('DPoP', [proof, proof] as unknown as string);
    expect(res.status).toBe(401);
  });
});

describe('failed-authentication budget', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await TestContext.create({ env: { RATE_LIMIT_AUTH_FAILURES_PER_IP: '3' } });
    // Redis is shared by the suites above; start with an empty failure budget.
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('blocks an IP that keeps failing, even with valid credentials afterwards', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await request(ctx.app).get('/api/v1/auth/me').set('Authorization', 'DPoP bogus')).status).toBe(
        401,
      );
    }
    const client = await ctx.login(alice);
    const res = await client.get('/api/v1/auth/me');
    expect(res.status).toBe(429);
    expect(json(res).details).toMatchObject({ group: 'auth-failures', scope: 'ip' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
