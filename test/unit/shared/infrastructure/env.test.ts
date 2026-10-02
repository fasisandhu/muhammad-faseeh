import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../../src/shared/infrastructure/config/env.js';

const base = {
  PUBLIC_BASE_URL: 'http://localhost:3000/',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://app.example.com',
  DATABASE_URL: 'postgres://ggi_app:pw@localhost:5432/ggi',
  REDIS_URL: 'redis://:pw@localhost:6379',
  OIDC_ISSUER: 'http://localhost:8080/realms/ggi',
  OIDC_JWKS_URI: 'http://localhost:8080/realms/ggi/protocol/openid-connect/certs',
  HEALTH_CHECK_TOKEN: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(base);
    expect(config.publicBaseUrl).toBe('http://localhost:3000');
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
    expect(config.trustProxy).toBe(false);
    expect(config.oidc.audience).toBe('ggi-api');
    expect(config.oidc.allowedAlgs).toEqual(['RS256', 'PS256', 'ES256']);
    expect(config.oidc.rolesClaim).toBe('realm_access.roles');
    expect(config.http).toEqual({ requestTimeoutMs: 10_000, bodyLimitBytes: 16_384, maxUrlLength: 2048 });
    expect(config.rateLimits.chat).toEqual({ ipPerMin: 60, userPerMin: 20 });
    expect(config.rateLimits.authFailures).toEqual({ perIp: 30, windowSec: 900 });
    expect(config.quota.freeMessagesPerMonth).toBe(3);
    expect(config.llm.timeoutMs).toBe(8000);
    expect(config.payments.failureRate).toBe(0.2);
    expect(config.jobs).toEqual({
      enabled: true,
      intervalMs: 60_000,
      billingMaxPerRun: 500,
      pendingMessageTimeoutSec: 120,
    });
  });

  it('requires the pending-reservation timeout to outlast the request timeout by more than 5 s', () => {
    const rejected = (extra: Record<string, string>) => () => loadConfig({ ...base, ...extra });
    expect(rejected({ PENDING_MESSAGE_TIMEOUT_SEC: '10' })).toThrow(
      /PENDING_MESSAGE_TIMEOUT_SEC.*REQUEST_TIMEOUT_MS/,
    );
    expect(rejected({ PENDING_MESSAGE_TIMEOUT_SEC: '15' })).toThrow(ConfigError);
    expect(
      rejected({ PENDING_MESSAGE_TIMEOUT_SEC: '40', REQUEST_TIMEOUT_MS: '35000', LLM_TIMEOUT_MS: '8000' }),
    ).toThrow(ConfigError);
    expect(rejected({ PENDING_MESSAGE_TIMEOUT_SEC: '16' })).not.toThrow();
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: '*' })).toThrow(ConfigError);
  });

  it('rejects CORS entries that are not bare origins', () => {
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: 'https://app.example.com/path' })).toThrow(
      ConfigError,
    );
  });

  it('rejects a short health-check token', () => {
    expect(() => loadConfig({ ...base, HEALTH_CHECK_TOKEN: 'short' })).toThrow(/HEALTH_CHECK_TOKEN/);
  });

  it('requires the LLM timeout to be below the request timeout', () => {
    expect(() => loadConfig({ ...base, LLM_TIMEOUT_MS: '10000' })).toThrow(/LLM_TIMEOUT_MS/);
  });

  it('accepts a proxy hop count but never "true"', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('rejects HMAC algorithms for access tokens', () => {
    expect(() => loadConfig({ ...base, OIDC_ALLOWED_ALGS: 'HS256' })).toThrow(/OIDC_ALLOWED_ALGS/);
  });

  it('parses booleans strictly', () => {
    expect(loadConfig({ ...base, JOBS_ENABLED: 'false' }).jobs.enabled).toBe(false);
    expect(() => loadConfig({ ...base, JOBS_ENABLED: 'yes' })).toThrow(/JOBS_ENABLED/);
  });

  it('reports missing required variables by name', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
