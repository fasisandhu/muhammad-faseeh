import * as client from 'openid-client';
import { DEFAULT_OIDC, discover, importDpopKeyPair, type DpopKeyPair } from './oidc.js';
import { loadSession, saveSession, type StoredSession } from './session-store.js';

export const API_BASE_URL = process.env.GGI_API_URL ?? 'http://localhost:3000';

export interface ApiResponse {
  status: number;
  body: unknown;
  requestId: string | null;
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
      new URL(path, API_BASE_URL),
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
  return {
    status: response.status,
    body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
    requestId: response.headers.get('x-request-id'),
  };
}

async function ensureFresh(
  config: client.Configuration,
  session: StoredSession,
  keyPair: DpopKeyPair,
): Promise<StoredSession> {
  if (session.expiresAt - 30_000 > Date.now() || session.refreshToken === null) return session;
  const tokens = await client.refreshTokenGrant(config, session.refreshToken, undefined, {
    DPoP: client.getDPoPHandle(config, keyPair),
  });
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
