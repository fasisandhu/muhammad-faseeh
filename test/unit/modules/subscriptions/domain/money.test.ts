import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../../src/shared/domain/errors.js';
import { usd } from '../../../../../src/modules/subscriptions/domain/value-objects/money.js';

describe('usd', () => {
  it('builds integer-cent amounts', () => {
    expect(usd(999)).toEqual({ amountCents: 999, currency: 'USD' });
    expect(usd(0)).toEqual({ amountCents: 0, currency: 'USD' });
  });

  it.each([-1, 9.99, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (value) => {
    expect(() => usd(value)).toThrow(ValidationError);
  });
});
