import type { Response } from 'express';
import type { ErrorCode } from '../domain/errors.js';

export type { ErrorCode } from '../domain/errors.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

export const ERROR_CATALOG: Record<ErrorCode, { status: number; title: string }> = {
  VALIDATION_FAILED: { status: 400, title: 'Validation failed' },
  MALFORMED_JSON: { status: 400, title: 'Malformed JSON' },
  UNAUTHENTICATED: { status: 401, title: 'Unauthenticated' },
  QUOTA_EXHAUSTED: { status: 402, title: 'Quota exhausted' },
  PAYMENT_FAILED: { status: 402, title: 'Payment failed' },
  FORBIDDEN: { status: 403, title: 'Forbidden' },
  CORS_ORIGIN_DENIED: { status: 403, title: 'Origin not allowed' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  ROUTE_NOT_FOUND: { status: 404, title: 'Route not found' },
  NOT_ACCEPTABLE: { status: 406, title: 'Not acceptable' },
  SUBSCRIPTION_NOT_ACTIVE: { status: 409, title: 'Subscription not active' },
  INVALID_STATE: { status: 409, title: 'Invalid state' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  URI_TOO_LONG: { status: 414, title: 'URI too long' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
  LLM_UNAVAILABLE: { status: 502, title: 'Language model unavailable' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
  REQUEST_TIMEOUT: { status: 503, title: 'Request timed out' },
  LLM_TIMEOUT: { status: 504, title: 'Language model timed out' },
};

/** RFC 9457 problem document with stable `code` and `requestId` extension members. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: ErrorCode;
  requestId: string;
  details?: Readonly<Record<string, unknown>>;
}

/** Transport-level failure (content type, size, CORS, rate limit…). Business failures use DomainError. */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}

export const problemType = (code: ErrorCode): string =>
  `urn:ggi:problem:${code.toLowerCase().replaceAll('_', '-')}`;

export function buildProblem(
  code: ErrorCode,
  detail: string,
  instance: string,
  requestId: string,
  details?: Readonly<Record<string, unknown>>,
): ProblemDetails {
  const { status, title } = ERROR_CATALOG[code];
  return {
    type: problemType(code),
    title,
    status,
    detail,
    instance,
    code,
    requestId,
    ...(details ? { details } : {}),
  };
}

export function sendProblem(
  res: Response,
  problem: ProblemDetails,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent) return;
  res.status(problem.status).set(headers).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
}
