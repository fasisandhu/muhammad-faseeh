import { createHash } from 'node:crypto';
import { calculateJwkThumbprint, decodeProtectedHeader, EmbeddedJWK, jwtVerify, type JWTPayload } from 'jose';
import { isRecord } from '../../../shared/domain/guards.js';
import { AuthenticationError } from '../domain/errors.js';
import type { ProofInput, ProofVerifier, ReplayCache } from '../domain/ports.js';

export interface DpopVerifierOptions {
  allowedAlgs: readonly string[];
  maxAgeSec: number;
  clockSkewSec: number;
  replayCache: ReplayCache;
}

const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

function fail(reason: string): never {
  throw new AuthenticationError('invalid_dpop_proof', reason);
}

/** RFC 9449 section 4.3: scheme, host and path must match; query and fragment are ignored. */
function normalizeHtu(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

export class JoseDpopProofVerifier implements ProofVerifier {
  constructor(private readonly options: DpopVerifierOptions) {}

  async verify(input: ProofInput): Promise<{ jkt: string; jti: string }> {
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(input.proof);
    } catch {
      fail('proof is not a compact JWS');
    }
    if (header.typ !== 'dpop+jwt') fail('typ must be dpop+jwt');
    if (typeof header.alg !== 'string' || !this.options.allowedAlgs.includes(header.alg)) {
      fail(`alg ${String(header.alg)} is not allowed`);
    }
    const jwk: unknown = header.jwk;
    if (!isRecord(jwk)) fail('jwk header is missing');
    if (PRIVATE_JWK_MEMBERS.some((member) => member in jwk)) fail('jwk header contains private key material');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(input.proof, EmbeddedJWK, {
        typ: 'dpop+jwt',
        algorithms: [...this.options.allowedAlgs],
        currentDate: input.now,
      }));
    } catch {
      fail('signature does not verify with the embedded jwk');
    }

    const jti = payload.jti;
    if (typeof jti !== 'string' || jti.length === 0 || jti.length > 256) fail('jti is missing or too long');
    if (payload.htm !== input.method.toUpperCase()) fail('htm does not match the request method');
    const htu = normalizeHtu(payload.htu);
    if (htu === null || htu !== normalizeHtu(input.url)) fail('htu does not match the request URL');

    const nowSec = Math.floor(input.now.getTime() / 1000);
    const iat = payload.iat;
    if (
      typeof iat !== 'number' ||
      iat < nowSec - this.options.maxAgeSec ||
      iat > nowSec + this.options.clockSkewSec
    ) {
      fail('iat is outside the acceptance window');
    }

    const expectedAth = createHash('sha256').update(input.accessToken).digest('base64url');
    if (payload.ath !== expectedAth) fail('ath does not match the access token');

    const jkt = await calculateJwkThumbprint(jwk, 'sha256');
    if (jkt !== input.expectedJkt) fail('proof key does not match the token binding (cnf.jkt)');

    // The entry must outlive the proof's own acceptance window (iat + maxAge), which for a proof dated in the near
    // future is longer than maxAge from now; the extra 2 s covers sub-second truncation of "now".
    const ttlMs = Math.max(1000, (iat + this.options.maxAgeSec - nowSec + 2) * 1000);
    const fresh = await this.options.replayCache.markIfUnseen(`${jkt}:${jti}`, ttlMs);
    if (!fresh) fail('proof was replayed (jti already used)');

    return { jkt, jti };
  }
}
