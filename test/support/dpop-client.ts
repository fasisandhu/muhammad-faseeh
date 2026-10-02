import { createHash, randomUUID } from 'node:crypto';
import { base64url, calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export interface ProofOptions {
  method: string;
  url: string;
  accessToken?: string;
  now: Date;
  iatOffsetSec?: number;
  jti?: string;
  typ?: string;
  omit?: readonly ('jti' | 'htm' | 'htu' | 'iat' | 'ath')[];
  claims?: Record<string, unknown>;
  embedPrivateKey?: boolean;
  /** Sign with a different key than the one embedded in the header (signature mismatch). */
  signWithOtherKey?: boolean;
}

export const accessTokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');

/** Plays the client side of DPoP in tests: owns a key pair and signs one proof per request. */
export class DpopTestClient {
  private constructor(
    private readonly keys: KeyPair,
    private readonly other: KeyPair,
    readonly publicJwk: JWK,
    readonly jkt: string,
  ) {}

  static async create(): Promise<DpopTestClient> {
    const [keys, other] = await Promise.all([
      generateKeyPair('ES256', { extractable: true }),
      generateKeyPair('ES256'),
    ]);
    const publicJwk = await exportJWK(keys.publicKey);
    return new DpopTestClient(keys, other, publicJwk, await calculateJwkThumbprint(publicJwk));
  }

  private payload(options: ProofOptions): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      jti: options.jti ?? randomUUID(),
      htm: options.method.toUpperCase(),
      htu: options.url,
      iat: Math.floor(options.now.getTime() / 1000) + (options.iatOffsetSec ?? 0),
    };
    if (options.accessToken !== undefined) payload.ath = accessTokenHash(options.accessToken);
    Object.assign(payload, options.claims);
    for (const name of options.omit ?? []) Reflect.deleteProperty(payload, name);
    return payload;
  }

  async proof(options: ProofOptions): Promise<string> {
    const jwk = options.embedPrivateKey ? await exportJWK(this.keys.privateKey) : this.publicJwk;
    return new SignJWT(this.payload(options))
      .setProtectedHeader({ alg: 'ES256', typ: options.typ ?? 'dpop+jwt', jwk })
      .sign(options.signWithOtherKey ? this.other.privateKey : this.keys.privateKey);
  }

  /** An `alg: none` proof, which must always be rejected. */
  unsignedProof(options: ProofOptions): string {
    const encode = (value: object) => base64url.encode(JSON.stringify(value));
    return `${encode({ alg: 'none', typ: 'dpop+jwt', jwk: this.publicJwk })}.${encode(this.payload(options))}.`;
  }
}
