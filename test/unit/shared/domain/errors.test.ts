import { describe, expect, it } from 'vitest';
import {
  DependencyUnavailableError,
  DomainError,
  ERROR_CODES,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../../../../src/shared/domain/errors.js';

describe('DomainError', () => {
  it('keeps code, message, details and a subclass name', () => {
    const error = new NotFoundError('Subscription', 'abc');
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.name).toBe('NotFoundError');
    expect(error.message).toBe('Subscription not found.');
    expect(error.details).toEqual({ resource: 'Subscription', id: 'abc' });
  });

  it('builds the other shared errors with stable codes', () => {
    expect(new ForbiddenError('read this message').code).toBe('FORBIDDEN');
    expect(new InvalidStateError('subscription', 'INACTIVE', 'cancel').details).toEqual({
      entity: 'subscription',
      state: 'INACTIVE',
      action: 'cancel',
    });
    expect(new DependencyUnavailableError('redis').code).toBe('SERVICE_UNAVAILABLE');
    expect(new DependencyUnavailableError('redis').dependency).toBe('redis');
    expect(new DependencyUnavailableError('redis').details).toEqual({});
    expect(new ValidationError('question', 'empty').code).toBe('VALIDATION_FAILED');
  });

  it('lists every error code exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toHaveLength(21);
  });
});
