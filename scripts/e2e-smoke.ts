import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { API_BASE_URL, sendWithDpop, type ApiResponse } from '../cli/api.js';
import { headlessLogin } from '../cli/headless-login.js';
import { DEFAULT_OIDC, discover, generateDpopKeyPair } from '../cli/oidc.js';

/** End-to-end check of the running docker compose stack with the real Keycloak (seeded demo users). */
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const body = (r: ApiResponse) =>
  (r.body ?? {}) as { code?: string; data?: Record<string, unknown> & { charge?: { source?: string } } };

const config = await discover(DEFAULT_OIDC);

async function session(username: string, password: string) {
  const { keyPair, stored } = await generateDpopKeyPair();
  const tokens = await headlessLogin(config, DEFAULT_OIDC, { username, password }, keyPair);
  const call = (method: string, path: string, payload?: unknown) =>
    sendWithDpop(config, keyPair, tokens.access_token, method, path, payload);
  return { tokens, keyPair, stored, call };
}

const alice = await session('alice@example.com', 'Alice-Demo-Pass-2026!');
const me = await alice.call('GET', '/api/v1/auth/me');
check('alice authenticates with a DPoP-bound token', me.status === 200, `HTTP ${me.status}`);

const bearer = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
  headers: { authorization: `Bearer ${alice.tokens.access_token}` },
});
check(
  'the same token used as a plain Bearer token is rejected',
  bearer.status === 401,
  `HTTP ${bearer.status}`,
);

const proof = await new SignJWT({
  htm: 'GET',
  htu: `${API_BASE_URL}/api/v1/auth/me`,
  iat: Math.floor(Date.now() / 1000),
  jti: randomUUID(),
  ath: createHash('sha256').update(alice.tokens.access_token).digest('base64url'),
})
  .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: alice.stored.publicJwk })
  .sign(alice.keyPair.privateKey);
const replayOnce = () =>
  fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { authorization: `DPoP ${alice.tokens.access_token}`, dpop: proof },
  });
const first = await replayOnce();
const second = await replayOnce();
check(
  'a replayed DPoP proof is rejected',
  first.status === 200 && second.status === 401,
  `${first.status} then ${second.status}`,
);

// Make the run repeatable: cancel bundles left over from earlier runs.
const active = await alice.call('GET', '/api/v1/subscriptions?status=ACTIVE&limit=100');
for (const sub of ((active.body ?? { data: [] }) as { data: { id: string }[] }).data) {
  await alice.call('POST', `/api/v1/subscriptions/${sub.id}/cancellation`);
}

let exhausted: ApiResponse | null = null;
for (let i = 0; i < 5 && exhausted === null; i += 1) {
  const res = await alice.call('POST', '/api/v1/chat/messages', { question: `Smoke test question ${i + 1}` });
  if (res.status === 402) exhausted = res;
}
check(
  'the free quota ends with a typed 402 QUOTA_EXHAUSTED',
  exhausted !== null && body(exhausted).code === 'QUOTA_EXHAUSTED',
);

let bundleId: string | null = null;
for (let attempt = 1; attempt <= 6 && bundleId === null; attempt += 1) {
  const res = await alice.call('POST', '/api/v1/subscriptions', {
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    autoRenew: true,
  });
  if (res.status === 201) bundleId = String(body(res).data?.id);
  else
    console.log(
      `info  purchase attempt ${attempt} declined by the simulated gateway (${body(res).code ?? res.status})`,
    );
}
check('a Basic bundle can be bought', bundleId !== null);

const paid = await alice.call('POST', '/api/v1/chat/messages', { question: 'A paid question' });
const paidMessage = (body(paid).data as { message?: { charge?: { source?: string } } } | undefined)?.message;
check(
  'the next message is charged to the bundle',
  paid.status === 201 && paidMessage?.charge?.source === 'BUNDLE',
);

const cancel = await alice.call('POST', `/api/v1/subscriptions/${bundleId ?? 'missing'}/cancellation`);
check(
  'cancellation ends the bundle immediately',
  cancel.status === 200 && body(cancel).data?.status === 'INACTIVE',
);
const afterCancel = await alice.call('POST', '/api/v1/chat/messages', { question: 'After cancellation' });
check('messages are refused again after cancellation', afterCancel.status === 402);

check('alice cannot read admin metrics', (await alice.call('GET', '/api/v1/admin/metrics')).status === 403);
const admin = await session('admin@example.com', 'Admin-Demo-Pass-2026!');
check('admin can read metrics', (await admin.call('GET', '/api/v1/admin/metrics')).status === 200);
check(
  'admin can trigger a billing run',
  (await admin.call('POST', '/api/v1/admin/billing-runs')).status === 200,
);

check('logout succeeds', (await alice.call('POST', '/api/v1/auth/logout')).status === 204);
check(
  'tokens of a logged-out session are rejected',
  (await alice.call('GET', '/api/v1/auth/me')).status === 401,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
