import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { calculateJwkThumbprint } from 'jose';
import * as client from 'openid-client';
import { API_BASE_URL, callApi, type ApiResponse } from './api.js';
import {
  buildLoginRequest,
  DEFAULT_OIDC,
  discover,
  exchangeCode,
  generateDpopKeyPair,
  type TokenSet,
} from './oidc.js';
import { clearSession, loadSession, saveSession } from './session-store.js';

const USAGE = `Usage: pnpm cli <command> [arguments]

  login                                   Sign in via Keycloak (email/password or GitHub), PKCE + DPoP
  logout                                  Revoke the session at the API and at Keycloak
  me | usage | plans
  chat "<question>"
  messages [--limit N]
  subs list
  subs create <BASIC|PRO|ENTERPRISE> <MONTHLY|YEARLY> [--no-auto-renew]
  subs auto-renew <id> <on|off>
  subs cancel <id>
  admin metrics | billing-run
  admin messages [--user ID]
  admin subscriptions [--user ID] [--status ACTIVE|INACTIVE]
  request <METHOD> <path> [json-body]`;

function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}

function print(response: ApiResponse): void {
  console.log(`HTTP ${response.status}${response.requestId ? `  (request ${response.requestId})` : ''}`);
  if (response.body !== null) console.log(JSON.stringify(response.body, null, 2));
  if (response.status >= 400) process.exitCode = 1;
}

async function login(): Promise<void> {
  const config = await discover(DEFAULT_OIDC);
  const { keyPair, stored } = await generateDpopKeyPair();
  const request = await buildLoginRequest(config, DEFAULT_OIDC, keyPair);
  const redirect = new URL(DEFAULT_OIDC.redirectUri);
  const tokens = await new Promise<TokenSet>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirect.origin);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      exchangeCode(config, url, request, keyPair).then(
        (result) => {
          res
            .writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
            .end('Login complete. You can close this tab.');
          server.close();
          resolve(result);
        },
        (error: unknown) => {
          res
            .writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
            .end('Login failed. See the terminal.');
          server.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
    server.listen(Number(redirect.port), redirect.hostname, () => {
      console.log(`Opening the Keycloak login page:\n${request.url.href}\n`);
      openBrowser(request.url.href);
    });
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes waiting for the browser login.'));
    }, 300_000).unref();
  });
  await saveSession({
    apiBaseUrl: API_BASE_URL,
    keys: stored,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
    expiresAt: Date.now() + (tokens.expiresIn() ?? 300) * 1000,
  });
  console.log(`Logged in. Tokens are bound to DPoP key ${await calculateJwkThumbprint(stored.publicJwk)}.`);
}

async function logout(): Promise<void> {
  const session = await loadSession();
  if (!session) {
    console.log('Not logged in.');
    return;
  }
  print(await callApi('POST', '/api/v1/auth/logout'));
  if (session.refreshToken !== null) {
    const config = await discover(DEFAULT_OIDC);
    await client.tokenRevocation(config, session.refreshToken).catch(() => undefined);
  }
  await clearSession();
  console.log('Session removed.');
}

const query = (values: Record<string, string | undefined>): string => {
  const params = new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return params.size > 0 ? `?${params.toString()}` : '';
};

interface Options {
  limit?: string;
  user?: string;
  status?: string;
  'no-auto-renew'?: boolean;
}

/** Maps a command to one API call; null means "unknown command". */
function dispatch(
  command: string | undefined,
  sub: string | undefined,
  rest: string[],
  values: Options,
): Promise<ApiResponse> | null {
  switch (command) {
    case 'me':
      return callApi('GET', '/api/v1/auth/me');
    case 'usage':
      return callApi('GET', '/api/v1/chat/usage');
    case 'plans':
      return callApi('GET', '/api/v1/subscription-plans');
    case 'chat':
      return callApi('POST', '/api/v1/chat/messages', { question: [sub, ...rest].join(' ') });
    case 'messages':
      return callApi('GET', `/api/v1/chat/messages${query({ limit: values.limit })}`);
    case 'subs':
      if (sub === 'list') return callApi('GET', '/api/v1/subscriptions');
      if (sub === 'create') {
        return callApi('POST', '/api/v1/subscriptions', {
          tier: rest[0],
          billingCycle: rest[1],
          autoRenew: values['no-auto-renew'] !== true,
        });
      }
      if (sub === 'auto-renew')
        return callApi('PATCH', `/api/v1/subscriptions/${rest[0] ?? ''}`, { autoRenew: rest[1] === 'on' });
      if (sub === 'cancel') return callApi('POST', `/api/v1/subscriptions/${rest[0] ?? ''}/cancellation`);
      return null;
    case 'admin':
      if (sub === 'metrics') return callApi('GET', '/api/v1/admin/metrics');
      if (sub === 'billing-run') return callApi('POST', '/api/v1/admin/billing-runs');
      if (sub === 'messages')
        return callApi('GET', `/api/v1/admin/chat/messages${query({ userId: values.user })}`);
      if (sub === 'subscriptions') {
        return callApi(
          'GET',
          `/api/v1/admin/subscriptions${query({ userId: values.user, status: values.status })}`,
        );
      }
      return null;
    case 'request': {
      const [path, json] = rest;
      return callApi(
        (sub ?? 'GET').toUpperCase(),
        path ?? '/',
        json === undefined ? undefined : (JSON.parse(json) as unknown),
      );
    }
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string' },
      user: { type: 'string' },
      status: { type: 'string' },
      'no-auto-renew': { type: 'boolean', default: false },
    },
  });
  const [command, sub, ...rest] = positionals;
  if (command === 'login') {
    await login();
    return;
  }
  if (command === 'logout') {
    await logout();
    return;
  }
  const call = dispatch(command, sub, rest, values);
  if (call === null) {
    console.log(USAGE);
    process.exitCode = command === undefined ? 0 : 1;
    return;
  }
  print(await call);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
