import { describe, expect, it } from 'vitest';
import {
  ChatMessageNotFoundError,
  InvalidQuestionError,
  LlmTimeoutError,
  LlmUnavailableError,
  QuotaExhaustedError,
} from '../../../../../src/modules/chat/domain/errors.js';

describe('Chat domain errors', () => {
  it('creates QuotaExhaustedError with details', () => {
    const error = new QuotaExhaustedError({
      period: '2026-10',
      free: { limit: 3, used: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
      bundles: { active: 0, withRemaining: 0 },
    });
    expect(error.code).toBe('QUOTA_EXHAUSTED');
    expect(error.details.period).toBe('2026-10');
  });

  it('creates InvalidQuestionError with reason', () => {
    const error = new InvalidQuestionError('too long');
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details.reason).toBe('too long');
  });

  it('creates ChatMessageNotFoundError with id', () => {
    const error = new ChatMessageNotFoundError('m-123');
    expect(error.code).toBe('NOT_FOUND');
  });

  it('creates LlmUnavailableError with provider', () => {
    const error = new LlmUnavailableError('openai');
    expect(error.code).toBe('LLM_UNAVAILABLE');
    expect(error.details.provider).toBe('openai');
  });

  it('creates LlmTimeoutError with duration', () => {
    const error = new LlmTimeoutError(8000);
    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.details.timeoutMs).toBe(8000);
  });
});
