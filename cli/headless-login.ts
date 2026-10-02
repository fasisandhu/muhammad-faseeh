import type * as client from 'openid-client';
import {
  buildLoginRequest,
  exchangeCode,
  type DpopKeyPair,
  type OidcSettings,
  type TokenSet,
} from './oidc.js';

/**
 * Logs in through Keycloak's real HTML login form without a browser.
 * Used only by scripts that verify the running stack end to end; the API never sees passwords.
 */
export async function headlessLogin(
  config: client.Configuration,
  settings: OidcSettings,
  credentials: { username: string; password: string },
  keyPair: DpopKeyPair,
): Promise<TokenSet> {
  const request = await buildLoginRequest(config, settings, keyPair);
  const cookies = new Map<string, string>();
  const remember = (response: Response): void => {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair && index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookieHeader = (): string => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

  const loginPage = await fetch(request.url, { redirect: 'manual' });
  remember(loginPage);
  const html = await loginPage.text();
  const match = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html);
  if (!match?.[1]) {
    throw new Error(`Keycloak login form not found (HTTP ${loginPage.status}).`);
  }
  const action = match[1].replaceAll('&amp;', '&');

  const submitted = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
    body: new URLSearchParams({
      username: credentials.username,
      password: credentials.password,
      credentialId: '',
    }),
  });
  const location = submitted.headers.get('location');
  if (submitted.status !== 302 || !location?.startsWith(settings.redirectUri)) {
    throw new Error(
      `Login for ${credentials.username} failed (HTTP ${submitted.status}). Wrong password, brute-force lockout, or a pending required action.`,
    );
  }
  return exchangeCode(config, new URL(location), request, keyPair);
}
