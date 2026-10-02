import { loadConfig, type AppConfig } from '../../src/shared/infrastructure/config/env.js';

export const HEALTH_TOKEN = 'test-health-token-0123456789abcdef';

/** Generous limits by default so suites do not trip over each other; rate-limit tests override them. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_BASE_URL: 'http://api.test',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
  OIDC_ISSUER: 'http://idp.test/realms/ggi',
  OIDC_JWKS_URI: 'http://127.0.0.1:1/certs',
  HEALTH_CHECK_TOKEN: HEALTH_TOKEN,
  LOG_LEVEL: 'silent',
  JOBS_ENABLED: 'false',
  MOCK_LLM_MIN_LATENCY_MS: '0',
  MOCK_LLM_MAX_LATENCY_MS: '0',
  PAYMENT_MIN_LATENCY_MS: '0',
  PAYMENT_MAX_LATENCY_MS: '0',
  PAYMENT_FAILURE_RATE: '0',
  RATE_LIMIT_GLOBAL_IP_PER_MIN: '100000',
  RATE_LIMIT_AUTH_IP_PER_MIN: '100000',
  RATE_LIMIT_AUTH_USER_PER_MIN: '100000',
  RATE_LIMIT_CHAT_IP_PER_MIN: '100000',
  RATE_LIMIT_CHAT_USER_PER_MIN: '100000',
  RATE_LIMIT_SUBSCRIPTIONS_IP_PER_MIN: '100000',
  RATE_LIMIT_SUBSCRIPTIONS_USER_PER_MIN: '100000',
  RATE_LIMIT_ADMIN_IP_PER_MIN: '100000',
  RATE_LIMIT_ADMIN_USER_PER_MIN: '100000',
  RATE_LIMIT_AUTH_FAILURES_PER_IP: '100000',
};

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
