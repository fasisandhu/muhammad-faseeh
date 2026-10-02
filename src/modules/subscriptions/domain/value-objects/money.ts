import { ValidationError } from '../../../../shared/domain/errors.js';

/** Money is always integer cents; floating point never touches prices. */
export interface Money {
  readonly amountCents: number;
  readonly currency: 'USD';
}

export function usd(amountCents: number): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new ValidationError('amount', 'must be a non-negative integer number of cents');
  }
  return { amountCents, currency: 'USD' };
}
