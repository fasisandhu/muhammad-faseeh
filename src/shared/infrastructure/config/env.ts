import { z } from 'zod';

const ASYMMETRIC_ALGS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const ratio = (fallback: number) => z.coerce.number().min(0).max(1).default(fallback);
const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');
const csv = (fallback?: string) =>
  (fallback === undefined ? z.string() : z.string().default(fallback)).transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
const algList = (fallback: string) =>
  csv(fallback).refine((algs) => algs.length > 0 && algs.every((alg) => ASYMMETRIC_ALGS.includes(alg)), {
    message: `must be a non-empty list of asymmetric JWS algorithms (${ASYMMETRIC_ALGS.join(', ')})`,
  });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000, 1, 65_535),
    PUBLIC_BASE_URL: z.url().transform((value) => value.replace(/\/+$/, '')),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value, ctx) => {
        if (value === 'false') return false as const;
        const hops = Number(value);
        if (Number.isInteger(hops) && hops >= 1 && hops <= 10) return hops;
        ctx.addIssue({ code: 'custom', message: 'must be "false" or a hop count between 1 and 10' });
        return z.NEVER;
      }),
    CORS_ALLOWED_ORIGINS: csv().refine(
      (origins) =>
        origins.length > 0 &&
        origins.every((origin) => {
          if (origin === '*') return false;
          try {
            return new URL(origin).origin === origin;
          } catch {
            return false;
          }
        }),
      {
        message: 'must be a comma-separated list of exact origins (scheme://host[:port]); "*" is not allowed',
      },
    ),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: int(10, 1, 100),
    REDIS_URL: z.string().min(1),
    OIDC_ISSUER: z.url(),
    OIDC_AUDIENCE: z.string().min(1).default('ggi-api'),
    OIDC_JWKS_URI: z.url(),
    OIDC_ALLOWED_ALGS: algList('RS256,PS256,ES256'),
    OIDC_ROLES_CLAIM: z.string().min(1).default('realm_access.roles'),
    OIDC_CLOCK_TOLERANCE_SEC: int(5, 0, 60),
    DPOP_ALLOWED_ALGS: algList('ES256,RS256,PS256,EdDSA'),
    DPOP_MAX_AGE_SEC: int(60, 1, 300),
    DPOP_CLOCK_SKEW_SEC: int(5, 0, 60),
    SESSION_REVOCATION_TTL_SEC: int(36_000, 60),
    REQUEST_TIMEOUT_MS: int(10_000, 100),
    BODY_LIMIT_BYTES: int(16_384, 1024, 1_048_576),
    HEALTH_CHECK_TOKEN: z.string().min(32, 'must be at least 32 characters'),
    RATE_LIMIT_GLOBAL_IP_PER_MIN: int(300, 1),
    RATE_LIMIT_AUTH_IP_PER_MIN: int(20, 1),
    RATE_LIMIT_AUTH_USER_PER_MIN: int(10, 1),
    RATE_LIMIT_CHAT_IP_PER_MIN: int(60, 1),
    RATE_LIMIT_CHAT_USER_PER_MIN: int(20, 1),
    RATE_LIMIT_SUBSCRIPTIONS_IP_PER_MIN: int(60, 1),
    RATE_LIMIT_SUBSCRIPTIONS_USER_PER_MIN: int(30, 1),
    RATE_LIMIT_ADMIN_IP_PER_MIN: int(120, 1),
    RATE_LIMIT_ADMIN_USER_PER_MIN: int(60, 1),
    RATE_LIMIT_AUTH_FAILURES_PER_IP: int(30, 1),
    RATE_LIMIT_AUTH_FAILURES_WINDOW_SEC: int(900, 1),
    FREE_MESSAGES_PER_MONTH: int(3, 0),
    LLM_TIMEOUT_MS: int(8000, 100),
    MOCK_LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
    MOCK_LLM_MIN_LATENCY_MS: int(300),
    MOCK_LLM_MAX_LATENCY_MS: int(1500),
    MOCK_LLM_FAILURE_RATE: ratio(0),
    PAYMENT_FAILURE_RATE: ratio(0.2),
    PAYMENT_MIN_LATENCY_MS: int(50),
    PAYMENT_MAX_LATENCY_MS: int(200),
    JOBS_ENABLED: bool('true'),
    JOBS_INTERVAL_MS: int(60_000, 1000),
    BILLING_MAX_PER_RUN: int(500, 1),
    PENDING_MESSAGE_TIMEOUT_SEC: int(120, 10),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_TIMEOUT_MS >= env.REQUEST_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_TIMEOUT_MS'],
        message: 'must be lower than REQUEST_TIMEOUT_MS',
      });
    }
    if (env.PENDING_MESSAGE_TIMEOUT_SEC * 1000 <= env.REQUEST_TIMEOUT_MS + 5000) {
      ctx.addIssue({
        code: 'custom',
        path: ['PENDING_MESSAGE_TIMEOUT_SEC'],
        message:
          'PENDING_MESSAGE_TIMEOUT_SEC * 1000 must exceed REQUEST_TIMEOUT_MS + 5000, otherwise the sweeper could refund a reservation whose request is still running',
      });
    }
    if (env.MOCK_LLM_MIN_LATENCY_MS > env.MOCK_LLM_MAX_LATENCY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_LLM_MIN_LATENCY_MS'],
        message: 'must not exceed MOCK_LLM_MAX_LATENCY_MS',
      });
    }
    if (env.PAYMENT_MIN_LATENCY_MS > env.PAYMENT_MAX_LATENCY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_MIN_LATENCY_MS'],
        message: 'must not exceed PAYMENT_MAX_LATENCY_MS',
      });
    }
  });

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export type AppConfig = ReturnType<typeof toAppConfig>;

function toAppConfig(env: z.output<typeof EnvSchema>) {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    trustProxy: env.TRUST_PROXY,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS as readonly string[],
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    redis: { url: env.REDIS_URL },
    oidc: {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
      jwksUri: env.OIDC_JWKS_URI,
      allowedAlgs: env.OIDC_ALLOWED_ALGS as readonly string[],
      rolesClaim: env.OIDC_ROLES_CLAIM,
      clockToleranceSec: env.OIDC_CLOCK_TOLERANCE_SEC,
    },
    dpop: {
      allowedAlgs: env.DPOP_ALLOWED_ALGS as readonly string[],
      maxAgeSec: env.DPOP_MAX_AGE_SEC,
      clockSkewSec: env.DPOP_CLOCK_SKEW_SEC,
    },
    session: { revocationTtlSec: env.SESSION_REVOCATION_TTL_SEC },
    http: {
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      bodyLimitBytes: env.BODY_LIMIT_BYTES,
      maxUrlLength: 2048,
    },
    health: { token: env.HEALTH_CHECK_TOKEN },
    rateLimits: {
      globalIpPerMin: env.RATE_LIMIT_GLOBAL_IP_PER_MIN,
      auth: { ipPerMin: env.RATE_LIMIT_AUTH_IP_PER_MIN, userPerMin: env.RATE_LIMIT_AUTH_USER_PER_MIN },
      chat: { ipPerMin: env.RATE_LIMIT_CHAT_IP_PER_MIN, userPerMin: env.RATE_LIMIT_CHAT_USER_PER_MIN },
      subscriptions: {
        ipPerMin: env.RATE_LIMIT_SUBSCRIPTIONS_IP_PER_MIN,
        userPerMin: env.RATE_LIMIT_SUBSCRIPTIONS_USER_PER_MIN,
      },
      admin: { ipPerMin: env.RATE_LIMIT_ADMIN_IP_PER_MIN, userPerMin: env.RATE_LIMIT_ADMIN_USER_PER_MIN },
      authFailures: {
        perIp: env.RATE_LIMIT_AUTH_FAILURES_PER_IP,
        windowSec: env.RATE_LIMIT_AUTH_FAILURES_WINDOW_SEC,
      },
    },
    quota: { freeMessagesPerMonth: env.FREE_MESSAGES_PER_MONTH },
    llm: {
      timeoutMs: env.LLM_TIMEOUT_MS,
      model: env.MOCK_LLM_MODEL,
      minLatencyMs: env.MOCK_LLM_MIN_LATENCY_MS,
      maxLatencyMs: env.MOCK_LLM_MAX_LATENCY_MS,
      failureRate: env.MOCK_LLM_FAILURE_RATE,
    },
    payments: {
      failureRate: env.PAYMENT_FAILURE_RATE,
      minLatencyMs: env.PAYMENT_MIN_LATENCY_MS,
      maxLatencyMs: env.PAYMENT_MAX_LATENCY_MS,
    },
    jobs: {
      enabled: env.JOBS_ENABLED,
      intervalMs: env.JOBS_INTERVAL_MS,
      billingMaxPerRun: env.BILLING_MAX_PER_RUN,
      pendingMessageTimeoutSec: env.PENDING_MESSAGE_TIMEOUT_SEC,
    },
    logLevel: env.LOG_LEVEL,
  };
}

/** Validates the environment once at startup and fails fast with every problem listed. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return toAppConfig(parsed.data);
}
