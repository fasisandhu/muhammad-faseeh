import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/shared/domain/errors.js';
import {
  ChatMessageNotFoundError,
  ChatRequestAbortedError,
  LlmTimeoutError,
  LlmUnavailableError,
} from '../../../src/modules/chat/domain/errors.js';
import { AuthenticationError } from '../../../src/modules/identity/domain/errors.js';
import {
  PaymentFailedError,
  SubscriptionNotFoundError,
} from '../../../src/modules/subscriptions/domain/errors.js';

describe('module errors carry stable codes and safe messages', () => {
  it.each([
    [new ChatMessageNotFoundError('m-1'), 'NOT_FOUND'],
    [new LlmUnavailableError('mock-openai'), 'LLM_UNAVAILABLE'],
    [new LlmTimeoutError(8000), 'LLM_TIMEOUT'],
    [new ChatRequestAbortedError('client closed'), 'REQUEST_TIMEOUT'],
    [new SubscriptionNotFoundError('s-1'), 'NOT_FOUND'],
    [new PaymentFailedError('s-1', 'card_declined'), 'PAYMENT_FAILED'],
    [new AuthenticationError('missing', 'no header'), 'UNAUTHENTICATED'],
  ])('%s → %s', (error, code) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('never exposes the internal authentication reason in the public details', () => {
    const error = new AuthenticationError('invalid_dpop_proof', 'jti replayed');
    expect(error.details).toEqual({ challenge: 'invalid_dpop_proof' });
    expect(error.message).not.toContain('jti');
  });
});
