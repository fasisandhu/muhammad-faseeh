import { SignJWT, calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair } from 'jose';
import { DEFAULT_OIDC, discover, generateDpopKeyPair } from '../cli/oidc.js';
import { headlessLogin } from '../cli/headless-login.js';

const accounts = [
  { username: 'alice@example.com', password: 'Alice-Demo-Pass-2026!', expectAdmin: false },
  { username: 'admin@example.com', password: 'Admin-Demo-Pass-2026!', expectAdmin: true },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const config = await discover(DEFAULT_OIDC);
let failures = 0;

for (const account of accounts) {
  const { keyPair, stored } = await generateDpopKeyPair();
  const tokens = await headlessLogin(config, DEFAULT_OIDC, account, keyPair);
  const claims = decodeJwt(tokens.access_token);
  const cnf = isRecord(claims.cnf) ? claims.cnf : {};
  const realmAccess = isRecord(claims.realm_access) ? claims.realm_access : {};
  const roles = Array.isArray(realmAccess.roles) ? realmAccess.roles : [];
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const checks: Record<string, boolean> = {
    'token_type is DPoP': tokens.token_type.toLowerCase() === 'dpop',
    'cnf.jkt equals our key thumbprint': cnf.jkt === (await calculateJwkThumbprint(stored.publicJwk)),
    'iss is the configured issuer': claims.iss === DEFAULT_OIDC.issuer,
    'aud contains ggi-api': audience.includes('ggi-api'),
    'sub is present': typeof claims.sub === 'string' && claims.sub.length > 0,
    'realm_access.roles contains user': roles.includes('user'),
    'admin role matches expectation': roles.includes('admin') === account.expectAdmin,
  };
  console.log(`\n${account.username}`);
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures += 1;
  }
  console.log(
    `  info  sid present: ${typeof claims.sid === 'string'}; jti present: ${typeof claims.jti === 'string'}`,
  );
  console.log(`  info  claims: ${JSON.stringify(claims)}`);
}

// The password grant must be disabled for the public client. The request carries a valid DPoP proof so
// that Keycloak gets past the DPoP requirement and rejects it for the real reason (direct access grants off).
const tokenEndpoint = `${DEFAULT_OIDC.issuer}/protocol/openid-connect/token`;
const probeKeys = await generateKeyPair('ES256');
const probeProof = await new SignJWT({ htm: 'POST', htu: tokenEndpoint, jti: crypto.randomUUID() })
  .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: await exportJWK(probeKeys.publicKey) })
  .setIssuedAt()
  .sign(probeKeys.privateKey);
const passwordGrant = await fetch(tokenEndpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', DPoP: probeProof },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: DEFAULT_OIDC.clientId,
    username: 'alice@example.com',
    password: 'Alice-Demo-Pass-2026!',
  }),
});
const passwordGrantBody: unknown = await passwordGrant.json().catch(() => null);
const passwordGrantError = isRecord(passwordGrantBody) ? passwordGrantBody.error : undefined;
const passwordGrantRejected = passwordGrant.status === 400 && passwordGrantError === 'unauthorized_client';
console.log(
  `
  ${passwordGrantRejected ? 'PASS' : 'FAIL'}  password grant is rejected as unauthorized_client (HTTP ${passwordGrant.status}, error ${String(passwordGrantError)})`,
);
if (!passwordGrantRejected) failures += 1;

process.exitCode = failures === 0 ? 0 : 1;
