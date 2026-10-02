import * as client from 'openid-client';
import { DEFAULT_OIDC, discover, importDpopKeyPair, type DpopKeyPair } from './oidc.js';
import { clearSession, loadSession, saveSession, type StoredSession } from './session-store.js';

export const API_BASE_URL = process.env.GGI_API_URL ?? 'http://localhost:3000';

export interface ApiResponse {
  status: number;
  body: unknown;
  requestId: string | null;
}

/** Resolves a path against the API and refuses any other origin, so a DPoP token is never sent to another host. */
export function resolveApiUrl(path: string): URL {
  const base = new URL(API_BASE_URL);
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error(`Refusing to send credentials to ${url.origin}: only ${base.origin} is allowed.`);
  }
  return url;
}

/** Calls the API with `Authorization: DPoP <token>` and a fresh proof signed by our key (openid-client does both). */
export async function sendWithDpop(
  config: client.Configuration,
  keyPair: DpopKeyPair,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await client.fetchProtectedResource(
      config,
      accessToken,
      resolveApiUrl(path),
      method,
      body === undefined ? undefined : JSON.stringify(body),
      headers,
      { DPoP: client.getDPoPHandle(config, keyPair) },
    );
  } catch (error) {
    // openid-client throws on WWW-Authenticate challenges (401); the HTTP response is attached to the error.
    if (error instanceof Error && 'response' in error && error.response instanceof Response) {
      response = error.response;
    } else {
      throw error;
    }
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text; // not JSON (for example a proxy error page): return the raw text
    }
  }
  return {
    status: response.status,
    body: parsed,
    requestId: response.headers.get('x-request-id'),
  };
}

const SESSION_EXPIRED = 'Session expired. Run `pnpm cli login`.';

async function ensureFresh(
  config: client.Configuration,
  session: StoredSession,
  keyPair: DpopKeyPair,
): Promise<StoredSession> {
  if (session.expiresAt - 30_000 > Date.now()) return session;
  if (session.refreshToken === null) {
    if (session.expiresAt > Date.now()) return session;
    await clearSession();
    throw new Error(SESSION_EXPIRED);
  }
  let tokens: Awaited<ReturnType<typeof client.refreshTokenGrant>>;
  try {
    tokens = await client.refreshTokenGrant(config, session.refreshToken, undefined, {
      DPoP: client.getDPoPHandle(config, keyPair),
    });
  } catch {
    await clearSession();
    throw new Error(SESSION_EXPIRED);
  }
  const refreshed: StoredSession = {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn() ?? 300) * 1000,
  };
  await saveSession(refreshed);
  return refreshed;
}

export async function callApi(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const stored = await loadSession();
  if (!stored) throw new Error('Not logged in. Run `pnpm cli login` first.');
  const config = await discover(DEFAULT_OIDC);
  const keyPair = await importDpopKeyPair(stored.keys);
  const session = await ensureFresh(config, stored, keyPair);
  return sendWithDpop(config, keyPair, session.accessToken, method, path, body);
}
