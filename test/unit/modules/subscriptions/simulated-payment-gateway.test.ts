import { describe, expect, it } from 'vitest';
import { SimulatedPaymentGateway } from '../../../../src/modules/subscriptions/infrastructure/simulated-payment-gateway.js';
import { SequenceRandomSource } from '../../../support/sequence-random.js';

const ids = {
  next: (() => {
    let n = 0;
    return () => `id-${String(++n)}`;
  })(),
};
const request = (key: string) => ({
  subscriptionId: 's-1',
  userId: 'u-1',
  amount: { amountCents: 999, currency: 'USD' as const },
  kind: 'INITIAL' as const,
  idempotencyKey: key,
});

describe('SimulatedPaymentGateway', () => {
  it('fails when the random draw is below the failure rate', async () => {
    const gateway = new SimulatedPaymentGateway({
      failureRate: 0.2,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      random: new SequenceRandomSource([0.1, 0.9]),
      ids,
    });
    expect(await gateway.charge(request('a'))).toMatchObject({
      status: 'FAILED',
      failureReason: 'card_declined',
    });
    expect(await gateway.charge(request('b'))).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('returns the same result for the same idempotency key', async () => {
    const gateway = new SimulatedPaymentGateway({
      failureRate: 0.5,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      random: new SequenceRandomSource([0.9, 0.1]),
      ids,
    });
    const first = await gateway.charge(request('same'));
    const second = await gateway.charge(request('same'));
    expect(second).toEqual(first);
    expect(first.status).toBe('SUCCEEDED');
  });
});
