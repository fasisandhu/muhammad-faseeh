import * as client from 'openid-client';
import { calculateJwkThumbprint, exportJWK, importJWK, type JWK } from 'jose';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export const DEFAULT_OIDC: OidcSettings = {
  issuer: process.env.GGI_OIDC_ISSUER ?? 'http://localhost:8080/realms/ggi',
  clientId: process.env.GGI_OIDC_CLIENT_ID ?? 'ggi-cli',
  redirectUri: 'http://127.0.0.1:53682/callback',
  scope: 'openid profile email',
};

export type DpopKeyPair = Awaited<ReturnType<typeof client.randomDPoPKeyPair>>;
export type TokenSet = Awaited<ReturnType<typeof client.authorizationCodeGrant>>;

export interface StoredKeyPair {
  publicJwk: JWK;
  privateJwk: JWK;
}

export interface LoginRequest {
  url: URL;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export async function discover(settings: OidcSettings): Promise<client.Configuration> {
  const issuer = new URL(settings.issuer);
  // Plain HTTP is only acceptable for the local docker compose Keycloak.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- deprecated only to discourage use; required for the local HTTP Keycloak.
  const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined;
  return client.discovery(issuer, settings.clientId, undefined, client.None(), options);
}

export async function generateDpopKeyPair(): Promise<{ keyPair: DpopKeyPair; stored: StoredKeyPair }> {
  const keyPair = await client.randomDPoPKeyPair('ES256', { extractable: true });
  const [publicJwk, privateJwk] = await Promise.all([
    exportJWK(keyPair.publicKey),
    exportJWK(keyPair.privateKey),
  ]);
  return { keyPair, stored: { publicJwk, privateJwk } };
}

export async function importDpopKeyPair(stored: StoredKeyPair): Promise<DpopKeyPair> {
  const privateKey = (await importJWK(stored.privateJwk, 'ES256', {
    extractable: false,
  })) as DpopKeyPair['privateKey'];
  const publicKey = (await importJWK(stored.publicJwk, 'ES256', {
    extractable: true,
  })) as DpopKeyPair['publicKey'];
  return { privateKey, publicKey };
}

/** Authorization Code + PKCE (S256), with `dpop_jkt` binding the code to our DPoP key (RFC 9449 §10). */
export async function buildLoginRequest(
  config: client.Configuration,
  settings: OidcSettings,
  keyPair: DpopKeyPair,
): Promise<LoginRequest> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: settings.redirectUri,
    scope: settings.scope,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    dpop_jkt: await calculateJwkThumbprint(await exportJWK(keyPair.publicKey)),
  });
  return { url, codeVerifier, state, nonce };
}

export async function exchangeCode(
  config: client.Configuration,
  callbackUrl: URL,
  request: LoginRequest,
  keyPair: DpopKeyPair,
): Promise<TokenSet> {
  return client.authorizationCodeGrant(
    config,
    callbackUrl,
    { pkceCodeVerifier: request.codeVerifier, expectedState: request.state, expectedNonce: request.nonce },
    undefined,
    { DPoP: client.getDPoPHandle(config, keyPair) },
  );
}
