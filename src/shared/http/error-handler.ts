import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { DomainError, type ErrorCode, type ErrorDetails } from '../domain/errors.js';
import { isRecord } from '../domain/guards.js';
import { pathOf } from './path.js';
import { buildProblem, ERROR_CATALOG, HttpError, sendProblem } from './problem.js';

interface Mapped {
  code: ErrorCode;
  detail: string;
  details?: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
}

const BODY_PARSER_CODES: Record<string, ErrorCode> = {
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'entity.parse.failed': 'MALFORMED_JSON',
  'charset.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
  'encoding.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
};

/** RFC 9449 §7.1: 401s caused by DPoP authentication carry a `WWW-Authenticate: DPoP` challenge. */
function withDpopChallenge(mapped: Mapped, dpopAlgs: readonly string[]): Mapped {
  const challenge = mapped.details?.challenge;
  if (mapped.code !== 'UNAUTHENTICATED' || typeof challenge !== 'string' || mapped.headers) return mapped;
  const errorParam = challenge === 'missing' ? '' : `error="${challenge}", `;
  return { ...mapped, headers: { 'WWW-Authenticate': `DPoP ${errorParam}algs="${dpopAlgs.join(' ')}"` } };
}

function map(error: unknown, dpopAlgs: readonly string[]): Mapped {
  if (error instanceof HttpError) {
    return withDpopChallenge(
      { code: error.code, detail: error.message, details: error.details, headers: error.headers },
      dpopAlgs,
    );
  }
  if (error instanceof DomainError) {
    return withDpopChallenge(
      { code: error.code, detail: error.message, details: error.details as ErrorDetails },
      dpopAlgs,
    );
  }
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      detail: 'The request is invalid.',
      details: {
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    };
  }
  if (isRecord(error) && typeof error.type === 'string' && error.type in BODY_PARSER_CODES) {
    const code = BODY_PARSER_CODES[error.type] ?? 'VALIDATION_FAILED';
    return {
      code,
      detail:
        code === 'MALFORMED_JSON' ? 'The request body is not valid JSON.' : 'The request body was rejected.',
    };
  }
  return { code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred.' };
}

/** Centralised error handling: every failure becomes an RFC 9457 problem document; internals stay in the logs. */
export function createErrorHandler(
  logger: Logger,
  options: { dpopAlgs: readonly string[] },
): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const mapped = map(error, options.dpopAlgs);
    const status = ERROR_CATALOG[mapped.code].status;
    const reason = isRecord(error) && typeof error.reason === 'string' ? error.reason : undefined;
    const level =
      status >= 500 ? 'error' : status === 401 || status === 403 || status === 429 ? 'warn' : 'info';
    logger[level](
      { err: status >= 500 ? error : undefined, code: mapped.code, status, reason, path: pathOf(req) },
      'request rejected',
    );
    if (res.headersSent) return;
    sendProblem(
      res,
      buildProblem(mapped.code, mapped.detail, pathOf(req), res.locals.requestId, mapped.details),
      mapped.headers,
    );
  };
}
