import { base64url, createRemoteJWKSet } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../../src/shared/domain/errors.js';
import { AuthenticationError } from '../../../../src/modules/identity/domain/errors.js';
import { JoseAccessTokenVerifier } from '../../../../src/modules/identity/infrastructure/access-token-verifier.js';
import { MockIdp } from '../../../support/mock-idp.js';

const now = new Date('2026-10-15T12:00:00.000Z');
let idp: MockIdp;
let verifier: JoseAccessTokenVerifier;

beforeAll(async () => {
  idp = await MockIdp.create();
  verifier = new JoseAccessTokenVerifier({
    issuer: idp.issuer,
    audience: idp.audience,
    allowedAlgs: ['RS256', 'PS256', 'ES256'],
    clockToleranceSec: 5,
    rolesClaim: 'realm_access.roles',
    keys: idp.localKeySet(),
  });
});

const rejectsWith = async (token: string, at = now) => {
  const error = await verifier.verify(token, at).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AuthenticationError);
  expect((error as AuthenticationError).details.challenge).toBe('invalid_token');
  return error as AuthenticationError;
};

describe('JoseAccessTokenVerifier', () => {
  it('accepts a valid sender-constrained token and maps its claims', async () => {
    const token = await idp.issueAccessToken({
      subject: 'alice',
      now,
      jkt: 'thumb-1',
      roles: ['user', 'admin', 'offline_access'],
      sessionId: 'sid-1',
      tokenId: 'jti-1',
    });
    const verified = await verifier.verify(token, now);
    expect(verified).toMatchObject({
      issuer: idp.issuer,
      subject: 'alice',
      tokenId: 'jti-1',
      sessionId: 'sid-1',
      jkt: 'thumb-1',
      email: 'alice@example.com',
      expiresAt: new Date('2026-10-15T12:05:00.000Z'),
    });
    expect([...verified.roles]).toEqual(['user', 'admin']);
  });

  it('accepts tokens without email or sid (GitHub users with private email)', async () => {
    const token = await idp.issueAccessToken({
      subject: 'gh-user',
      now,
      jkt: 'thumb-1',
      email: null,
      sessionId: null,
    });
    const verified = await verifier.verify(token, now);
    expect(verified.email).toBeNull();
    expect(verified.sessionId).toBeNull();
  });

  it('rejects the wrong issuer', async () => {
    await rejectsWith(
      await idp.issueAccessToken({
        subject: 'a',
        now,
        jkt: 't',
        claims: { iss: 'http://evil.test/realms/ggi' },
      }),
    );
  });

  it('rejects the wrong audience (e.g. an ID token)', async () => {
    await rejectsWith(
      await idp.issueAccessToken({ subject: 'a', now, jkt: 't', claims: { aud: 'ggi-cli' } }),
    );
  });

  it('rejects expired tokens beyond the clock tolerance but accepts within it', async () => {
    const token = await idp.issueAccessToken({ subject: 'a', now, jkt: 't', expiresInSec: 60 });
    await expect(verifier.verify(token, new Date(now.getTime() + 64_000))).resolves.toBeDefined();
    await rejectsWith(token, new Date(now.getTime() + 66_000));
  });

  it('rejects tokens that are not valid yet', async () => {
    const nbf = Math.floor(now.getTime() / 1000) + 600;
    await rejectsWith(await idp.issueAccessToken({ subject: 'a', now, jkt: 't', claims: { nbf } }));
  });

  it('rejects forged signatures', async () => {
    await rejectsWith(await idp.issueAccessToken({ subject: 'a', now, jkt: 't', signer: 'rogue' }));
  });

  it('rejects algorithms outside the allowlist', async () => {
    const strict = new JoseAccessTokenVerifier({
      issuer: idp.issuer,
      audience: idp.audience,
      allowedAlgs: ['RS256'],
      clockToleranceSec: 5,
      rolesClaim: 'realm_access.roles',
      keys: idp.localKeySet(),
    });
    const token = await idp.issueAccessToken({ subject: 'a', now, jkt: 't', signer: 'ec' });
    await expect(strict.verify(token, now)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects alg "none"', async () => {
    const encode = (value: object) => base64url.encode(JSON.stringify(value));
    const iat = Math.floor(now.getTime() / 1000);
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ iss: idp.issuer, aud: idp.audience, sub: 'a', iat, exp: iat + 60, cnf: { jkt: 't' } })}.`;
    await rejectsWith(token);
  });

  it('rejects bearer tokens that are not sender-constrained', async () => {
    const error = await rejectsWith(await idp.issueAccessToken({ subject: 'a', now, jkt: null }));
    expect(error.reason).toMatch(/cnf/);
  });

  it('rejects tokens without a subject', async () => {
    await rejectsWith(await idp.issueAccessToken({ subject: 'a', now, jkt: 't', omit: ['sub'] }));
  });

  it('rejects garbage', async () => {
    await rejectsWith('not-a-jwt');
    await rejectsWith('a.b.c');
  });

  describe('with a remote JWKS', () => {
    const remote = (uri: string) =>
      new JoseAccessTokenVerifier({
        issuer: idp.issuer,
        audience: idp.audience,
        allowedAlgs: ['RS256'],
        clockToleranceSec: 5,
        rolesClaim: 'realm_access.roles',
        keys: createRemoteJWKSet(new URL(uri), { timeoutDuration: 1000 }),
      });

    it('verifies against keys fetched over HTTP', async () => {
      const uri = await idp.startServer();
      try {
        const token = await idp.issueAccessToken({ subject: 'alice', now, jkt: 't' });
        await expect(remote(uri).verify(token, now)).resolves.toMatchObject({ subject: 'alice' });
      } finally {
        await idp.stop();
      }
    });

    it('reports an unreachable or failing key endpoint as a dependency failure, not a bad token', async () => {
      const uri = await idp.startServer();
      const token = await idp.issueAccessToken({ subject: 'alice', now, jkt: 't' });
      try {
        await expect(remote(uri.replace('/certs', '/missing')).verify(token, now)).rejects.toBeInstanceOf(
          DependencyUnavailableError,
        );
      } finally {
        await idp.stop();
      }
      await expect(remote(uri).verify(token, now)).rejects.toBeInstanceOf(DependencyUnavailableError);
    });
  });
});
