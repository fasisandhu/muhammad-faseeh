import type { Payment, PaymentKind } from '../entities/payment.js';

export interface PaymentMetrics {
  succeeded: number;
  failed: number;
  revenueCents: number;
}

export interface PaymentRepository {
  insert(payment: Payment): Promise<void>;
  findFor(subscriptionId: string, kind: PaymentKind, periodStart: Date): Promise<Payment | null>;
  metricsSince(since: Date): Promise<PaymentMetrics>;
}
