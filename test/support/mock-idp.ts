import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

export interface IssueTokenInput {
  subject: string;
  now: Date;
  jkt: string | null;
  roles?: string[];
  email?: string | null;
  name?: string;
  sessionId?: string | null;
  tokenId?: string;
  expiresInSec?: number;
  /** Extra or overriding claims (e.g. iss, aud, nbf). */
  claims?: Record<string, unknown>;
  /** Claim names to remove from the token. */
  omit?: readonly string[];
  /** trusted = published RSA key; rogue = same kid, unpublished key; ec = published ES256 key. */
  signer?: 'trusted' | 'rogue' | 'ec';
}

/** A fake OpenID provider: real keys, real JWKS, real signatures. The API's verifier runs unchanged against it. */
export class MockIdp {
  private server: Server | null = null;

  private constructor(
    readonly issuer: string,
    readonly audience: string,
    private readonly rsa: KeyPair,
    private readonly rogue: KeyPair,
    private readonly ec: KeyPair,
    private readonly publicJwks: JSONWebKeySet,
  ) {}

  static async create(options: { issuer?: string; audience?: string } = {}): Promise<MockIdp> {
    const [rsa, rogue, ec] = await Promise.all([
      generateKeyPair('RS256'),
      generateKeyPair('RS256'),
      generateKeyPair('ES256'),
    ]);
    const rsaJwk: JWK = { ...(await exportJWK(rsa.publicKey)), kid: 'test-rsa', alg: 'RS256', use: 'sig' };
    const ecJwk: JWK = { ...(await exportJWK(ec.publicKey)), kid: 'test-ec', alg: 'ES256', use: 'sig' };
    return new MockIdp(
      options.issuer ?? 'http://idp.test/realms/ggi',
      options.audience ?? 'ggi-api',
      rsa,
      rogue,
      ec,
      { keys: [rsaJwk, ecJwk] },
    );
  }

  jwks(): JSONWebKeySet {
    return this.publicJwks;
  }

  localKeySet(): JWTVerifyGetKey {
    return createLocalJWKSet(this.publicJwks);
  }

  async issueAccessToken(input: IssueTokenInput): Promise<string> {
    const iat = Math.floor(input.now.getTime() / 1000);
    const claims: Record<string, unknown> = {
      iss: this.issuer,
      aud: [this.audience, 'account'],
      sub: input.subject,
      azp: 'ggi-cli',
      typ: 'Bearer',
      iat,
      exp: iat + (input.expiresInSec ?? 300),
      jti: input.tokenId ?? randomUUID(),
      realm_access: { roles: input.roles ?? ['user', 'default-roles-ggi', 'offline_access'] },
      name: input.name ?? `Test ${input.subject}`,
    };
    if (input.sessionId !== null) claims.sid = input.sessionId ?? randomUUID();
    if (input.email !== null) claims.email = input.email ?? `${input.subject}@example.com`;
    if (input.jkt !== null) claims.cnf = { jkt: input.jkt };
    Object.assign(claims, input.claims);
    for (const name of input.omit ?? []) Reflect.deleteProperty(claims, name);

    const signer = input.signer ?? 'trusted';
    const key =
      signer === 'ec' ? this.ec.privateKey : signer === 'rogue' ? this.rogue.privateKey : this.rsa.privateKey;
    const header =
      signer === 'ec'
        ? { alg: 'ES256', kid: 'test-ec', typ: 'JWT' }
        : { alg: 'RS256', kid: 'test-rsa', typ: 'JWT' };
    return new SignJWT(claims).setProtectedHeader(header).sign(key);
  }

  /** Serves the JWKS over HTTP on a random port; returns the JWKS URI. */
  async startServer(): Promise<string> {
    const body = JSON.stringify(this.publicJwks);
    this.server = createServer((req, res) => {
      if (req.url === '/certs') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(body);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/certs`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }
}
