export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'UNAUTHENTICATED',
  'QUOTA_EXHAUSTED',
  'PAYMENT_FAILED',
  'FORBIDDEN',
  'CORS_ORIGIN_DENIED',
  'NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'NOT_ACCEPTABLE',
  'SUBSCRIPTION_NOT_ACTIVE',
  'INVALID_STATE',
  'PAYLOAD_TOO_LARGE',
  'URI_TOO_LONG',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'LLM_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'REQUEST_TIMEOUT',
  'LLM_TIMEOUT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorDetails = Readonly<Record<string, unknown>>;

/** Base class for business-rule failures. The HTTP layer maps `code` to a status; the domain never sees HTTP. */
export class DomainError<TDetails extends ErrorDetails = ErrorDetails> extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: TDetails,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends DomainError<{ action: string }> {
  constructor(action: string) {
    super('FORBIDDEN', `You are not allowed to ${action}.`, { action });
  }
}

export class NotFoundError extends DomainError<{ resource: string; id: string }> {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found.`, { resource, id });
  }
}

export class InvalidStateError extends DomainError<{ entity: string; state: string; action: string }> {
  constructor(entity: string, state: string, action: string) {
    super('INVALID_STATE', `Cannot ${action} a ${entity} in state ${state}.`, { entity, state, action });
  }
}

export class DependencyUnavailableError extends DomainError<{ dependency: string }> {
  constructor(dependency: string) {
    super('SERVICE_UNAVAILABLE', 'A required dependency is temporarily unavailable.', { dependency });
  }
}

export class ValidationError extends DomainError<{ field: string; reason: string }> {
  constructor(field: string, reason: string) {
    super('VALIDATION_FAILED', `Invalid ${field}: ${reason}.`, { field, reason });
  }
}
