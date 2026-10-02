import type { Money } from '../value-objects/money.js';
import type { PaymentKind } from '../value-objects/payment-kind.js';

export interface ChargeRequest {
  subscriptionId: string;
  userId: string;
  amount: Money;
  kind: PaymentKind;
  /** Same key → same result; protects against double charging on retries. */
  idempotencyKey: string;
}

export type PaymentResult =
  { status: 'SUCCEEDED'; reference: string } | { status: 'FAILED'; reference: string; failureReason: string };

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<PaymentResult>;
}
