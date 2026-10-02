import type { PaymentResult } from '../ports/payment-gateway.js';
import type { Money } from '../value-objects/money.js';
import type { PaymentKind, PaymentStatus } from '../value-objects/payment-kind.js';
import type { Subscription } from './subscription.js';

export type { PaymentKind, PaymentStatus } from '../value-objects/payment-kind.js';

export interface PaymentProps {
  id: string;
  subscriptionId: string;
  userId: string;
  kind: PaymentKind;
  periodStart: Date;
  amount: Money;
  status: PaymentStatus;
  providerReference: string;
  failureReason: string | null;
  attemptedAt: Date;
}

/** Immutable record of one payment attempt; unique per (subscription, kind, periodStart). */
export class Payment {
  private constructor(private readonly props: PaymentProps) {}

  static record(input: {
    id: string;
    subscription: Subscription;
    kind: PaymentKind;
    periodStart: Date;
    result: PaymentResult;
    attemptedAt: Date;
  }): Payment {
    return new Payment({
      id: input.id,
      subscriptionId: input.subscription.id,
      userId: input.subscription.userId,
      kind: input.kind,
      periodStart: input.periodStart,
      amount: input.subscription.price,
      status: input.result.status,
      providerReference: input.result.reference,
      failureReason: input.result.status === 'FAILED' ? input.result.failureReason : null,
      attemptedAt: input.attemptedAt,
    });
  }

  static rehydrate(props: PaymentProps): Payment {
    return new Payment({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get subscriptionId(): string {
    return this.props.subscriptionId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get kind(): PaymentKind {
    return this.props.kind;
  }
  get periodStart(): Date {
    return this.props.periodStart;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get status(): PaymentStatus {
    return this.props.status;
  }
  get providerReference(): string {
    return this.props.providerReference;
  }
  get failureReason(): string | null {
    return this.props.failureReason;
  }
  get attemptedAt(): Date {
    return this.props.attemptedAt;
  }
  get succeeded(): boolean {
    return this.props.status === 'SUCCEEDED';
  }
}
