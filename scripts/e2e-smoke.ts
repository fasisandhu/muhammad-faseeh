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
const challenge = bearer.headers.get('www-authenticate') ?? '';
check(
  'the same token used as a plain Bearer token is rejected',
  bearer.status === 401 && challenge.startsWith('DPoP'),
  `HTTP ${bearer.status}, WWW-Authenticate: ${challenge}`,
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
const activeData = (active.body as { data?: unknown } | null)?.data;
if (active.status !== 200 || !Array.isArray(activeData)) {
  check('leftover bundles can be listed', false, `HTTP ${active.status} ${JSON.stringify(active.body)}`);
} else {
  for (const sub of activeData as { id: string }[]) {
    await alice.call('POST', `/api/v1/subscriptions/${sub.id}/cancellation`);
  }
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
let purchaseFailure = '';
for (let attempt = 1; attempt <= 6 && bundleId === null && purchaseFailure === ''; attempt += 1) {
  const res = await alice.call('POST', '/api/v1/subscriptions', {
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    autoRenew: true,
  });
  const id = body(res).data?.id;
  if (res.status === 201 && typeof id === 'string') bundleId = id;
  else if (body(res).code === 'PAYMENT_FAILED') {
    console.log(`info  purchase attempt ${attempt} declined by the simulated gateway (PAYMENT_FAILED)`);
  } else {
    purchaseFailure = `HTTP ${res.status} ${JSON.stringify(res.body)}`;
  }
}
check('a Basic bundle can be bought', bundleId !== null, purchaseFailure);

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
check(
  'messages are refused again after cancellation',
  afterCancel.status === 402 && body(afterCancel).code === 'QUOTA_EXHAUSTED',
  `HTTP ${afterCancel.status}`,
);

check('alice cannot read admin metrics', (await alice.call('GET', '/api/v1/admin/metrics')).status === 403);
const admin = await session('admin@example.com', 'Admin-Demo-Pass-2026!');
check('admin can read metrics', (await admin.call('GET', '/api/v1/admin/metrics')).status === 200);
const billing = await admin.call('POST', '/api/v1/admin/billing-runs');
const summary = body(billing).data;
check(
  'admin can trigger a billing run',
  billing.status === 200 &&
    typeof summary?.processed === 'number' &&
    typeof summary.renewed === 'number' &&
    typeof summary.paymentFailed === 'number' &&
    typeof summary.expired === 'number',
  `HTTP ${billing.status} ${JSON.stringify(billing.body)}`,
);

check('logout succeeds', (await alice.call('POST', '/api/v1/auth/logout')).status === 204);
check(
  'tokens of a logged-out session are rejected',
  (await alice.call('GET', '/api/v1/auth/me')).status === 401,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
