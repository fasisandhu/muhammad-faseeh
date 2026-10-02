import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';

export type QuotaExhaustedDetails = Readonly<{
  period: string;
  free: Readonly<{ limit: number; used: number; resetsAt: string }>;
  bundles: Readonly<{ active: number; withRemaining: number }>;
}>;

export class QuotaExhaustedError extends DomainError<QuotaExhaustedDetails> {
  constructor(details: QuotaExhaustedDetails) {
    super(
      'QUOTA_EXHAUSTED',
      `All ${details.free.limit} free messages for ${details.period} are used and no active bundle has messages left.`,
      details,
    );
  }
}

export class InvalidQuestionError extends DomainError<{ field: 'question'; reason: string }> {
  constructor(reason: string) {
    super('VALIDATION_FAILED', `Invalid question: ${reason}.`, { field: 'question', reason });
  }
}

export class ChatMessageNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('Chat message', id);
  }
}

export class LlmUnavailableError extends DomainError<{ provider: string }> {
  constructor(provider: string) {
    super('LLM_UNAVAILABLE', 'The language model is temporarily unavailable. Your quota was not charged.', {
      provider,
    });
  }
}

export class LlmTimeoutError extends DomainError<{ timeoutMs: number }> {
  constructor(timeoutMs: number) {
    super('LLM_TIMEOUT', 'The language model did not answer in time. Your quota was not charged.', {
      timeoutMs,
    });
  }
}

/** The request was cancelled (deadline or client disconnect) while waiting for the model; quota was refunded. */
export class ChatRequestAbortedError extends DomainError<{ reason: string }> {
  constructor(reason: string) {
    super(
      'REQUEST_TIMEOUT',
      'The request was cancelled before the model answered. Your quota was not charged.',
      { reason },
    );
  }
}
