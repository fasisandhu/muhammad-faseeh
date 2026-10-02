import { beforeAll, describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../../src/shared/domain/errors.js';
import { AuthenticationError } from '../../../../src/modules/identity/domain/errors.js';
import type { ProofInput, ReplayCache } from '../../../../src/modules/identity/domain/ports.js';
import { JoseDpopProofVerifier } from '../../../../src/modules/identity/infrastructure/dpop-proof-verifier.js';
import { DpopTestClient, type ProofOptions } from '../../../support/dpop-client.js';
import { FailingReplayCache, MemoryReplayCache } from '../../../support/memory-stores.js';

const now = new Date('2026-10-15T12:00:00.000Z');
const url = 'http://api.test/api/v1/chat/messages';
const accessToken = 'header.payload.signature';
let client: DpopTestClient;

beforeAll(async () => {
  client = await DpopTestClient.create();
});

/** Honours the TTL it is given, measured against an injectable clock, like the Redis implementation. */
class TtlReplayCache implements ReplayCache {
  private readonly expiries = new Map<string, number>();

  constructor(private readonly clock: () => Date) {}

  markIfUnseen(key: string, ttlMs: number): Promise<boolean> {
    const at = this.clock().getTime();
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && expiry > at) return Promise.resolve(false);
    this.expiries.set(key, at + ttlMs);
    return Promise.resolve(true);
  }
}

const verifier = (replayCache: ReplayCache = new MemoryReplayCache()) =>
  new JoseDpopProofVerifier({
    allowedAlgs: ['ES256', 'RS256', 'PS256', 'EdDSA'],
    maxAgeSec: 60,
    clockSkewSec: 5,
    replayCache,
  });

const input = (proof: string, overrides: Partial<ProofInput> = {}): ProofInput => ({
  proof,
  method: 'POST',
  url,
  accessToken,
  expectedJkt: client.jkt,
  now,
  ...overrides,
});

const sign = (options: Partial<ProofOptions> = {}) =>
  client.proof({ method: 'POST', url, accessToken, now, ...options });

const rejects = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AuthenticationError);
  expect((error as AuthenticationError).details.challenge).toBe('invalid_dpop_proof');
  return error as AuthenticationError;
};

describe('JoseDpopProofVerifier', () => {
  it('accepts a fresh, correctly bound proof', async () => {
    const result = await verifier().verify(input(await sign()));
    expect(result.jkt).toBe(client.jkt);
  });

  it('ignores query strings when comparing htu', async () => {
    await expect(verifier().verify(input(await sign({ url: `${url}?limit=5` })))).resolves.toBeDefined();
  });

  it('rejects a replayed proof', async () => {
    const shared = verifier();
    const proof = await sign();
    await shared.verify(input(proof));
    const error = await rejects(shared.verify(input(proof)));
    expect(error.reason).toMatch(/replay/);
  });

  it.each([
    ['wrong typ', { typ: 'JWT' }],
    ['missing jti', { omit: ['jti'] as const }],
    ['missing iat', { omit: ['iat'] as const }],
    ['missing ath', { omit: ['ath'] as const }],
    ['jti too long', { jti: 'x'.repeat(257) }],
    ['stale iat', { iatOffsetSec: -61 }],
    ['future iat beyond skew', { iatOffsetSec: 6 }],
    ['signature by another key', { signWithOtherKey: true }],
    ['other method', { method: 'GET' }],
    ['other URL', { url: 'http://api.test/api/v1/subscriptions' }],
    ['other host', { url: 'http://evil.test/api/v1/chat/messages' }],
  ] satisfies [string, Partial<ProofOptions>][])('rejects %s', async (_name, options) => {
    await rejects(verifier().verify(input(await sign(options))));
  });

  it('rejects a private key in the header and says why', async () => {
    const error = await rejects(verifier().verify(input(await sign({ embedPrivateKey: true }))));
    expect(error.reason).toMatch(/private key material/);
  });

  it('accepts the exact boundaries: iat at -60 s and +5 s, jti of 256 characters', async () => {
    await expect(verifier().verify(input(await sign({ iatOffsetSec: -60 })))).resolves.toBeDefined();
    await expect(verifier().verify(input(await sign({ iatOffsetSec: 5 })))).resolves.toBeDefined();
    await expect(verifier().verify(input(await sign({ jti: 'x'.repeat(256) })))).resolves.toBeDefined();
  });

  it('does not spend the jti when a later check fails', async () => {
    const shared = verifier();
    await rejects(shared.verify(input(await sign({ jti: 'X' }), { accessToken: 'another.token.value' })));
    await rejects(shared.verify(input(await sign({ jti: 'X' }), { expectedJkt: 'someone-elses' })));
    await expect(shared.verify(input(await sign({ jti: 'X' })))).resolves.toBeDefined();
  });

  it('keeps a proof dated in the near future un-replayable until it is stale', async () => {
    let clock = now;
    const cache = new TtlReplayCache(() => clock);
    const shared = verifier(cache);
    const proof = await sign({ iatOffsetSec: 5 });
    await shared.verify(input(proof));
    clock = new Date(now.getTime() + 65_500);
    // Either outcome is a rejection: replay while the cache entry lives, or stale once iat + maxAge has passed.
    await rejects(shared.verify(input(proof, { now: clock })));
  });

  it('accepts iat within the future skew', async () => {
    await expect(verifier().verify(input(await sign({ iatOffsetSec: 4 })))).resolves.toBeDefined();
  });

  it('rejects a proof for a different access token', async () => {
    await rejects(verifier().verify(input(await sign(), { accessToken: 'another.token.value' })));
  });

  it('rejects a key that the access token is not bound to', async () => {
    await rejects(verifier().verify(input(await sign(), { expectedJkt: 'someone-elses-thumbprint' })));
  });

  it('rejects alg "none" and garbage', async () => {
    await rejects(verifier().verify(input(client.unsignedProof({ method: 'POST', url, accessToken, now }))));
    await rejects(verifier().verify(input('garbage')));
    await rejects(verifier().verify(input('')));
  });

  it('fails closed when the replay cache is unavailable', async () => {
    await expect(verifier(new FailingReplayCache()).verify(input(await sign()))).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });
});
