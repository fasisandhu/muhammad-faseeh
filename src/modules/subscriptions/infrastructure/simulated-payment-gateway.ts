import { LRUCache } from 'lru-cache';
import type { IdGenerator } from '../../../shared/domain/ids.js';
import type { RandomSource } from '../../../shared/domain/random.js';
import { sleep } from '../../../shared/infrastructure/system/sleep.js';
import type { ChargeRequest, PaymentGateway, PaymentResult } from '../domain/ports/payment-gateway.js';

export interface SimulatedPaymentGatewayOptions {
  failureRate: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  random: RandomSource;
  ids: IdGenerator;
}

/**
 * Stand-in for a payment provider (spec §6.2–6.3): simulated latency, random declines at `failureRate`,
 * idempotent per key. Each charge draws exactly one random number for the outcome (plus one for latency
 * when min < max), which keeps tests deterministic.
 */
export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly results = new LRUCache<string, PaymentResult>({ max: 10_000 });

  constructor(private readonly options: SimulatedPaymentGatewayOptions) {}

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    const previous = this.results.get(request.idempotencyKey);
    if (previous) return previous;
    const { minLatencyMs, maxLatencyMs, random } = this.options;
    const latency =
      maxLatencyMs > minLatencyMs
        ? minLatencyMs + Math.floor(random.next() * (maxLatencyMs - minLatencyMs + 1))
        : minLatencyMs;
    await sleep(latency);
    const reference = `sim_${this.options.ids.next()}`;
    const result: PaymentResult =
      random.next() < this.options.failureRate
        ? { status: 'FAILED', reference, failureReason: 'card_declined' }
        : { status: 'SUCCEEDED', reference };
    this.results.set(request.idempotencyKey, result);
    return result;
  }
}
