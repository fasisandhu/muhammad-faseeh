import type { ChatDeps } from './chat-deps.js';

/** Crash safety (spec §6.1 step 6): refunds reservations whose request died between Tx1 and Tx2. */
export class SweepStaleReservations {
  constructor(private readonly deps: ChatDeps & { pendingTimeoutMs: number }) {}

  async execute(): Promise<{ refunded: number }> {
    const now = this.deps.clock.now();
    const candidates = await this.deps.messages.findStalePending(
      new Date(now.getTime() - this.deps.pendingTimeoutMs),
      100,
    );
    let refunded = 0;
    for (const candidate of candidates) {
      const done = await this.deps.tx.run(async () => {
        const usage = await this.deps.usage.lockForUpdate(candidate.userId, candidate.charge.period);
        const message = await this.deps.messages.lockById(candidate.id);
        if (message?.status !== 'PENDING') return false;
        usage.refund(message.charge);
        await this.deps.usage.save(usage);
        if (message.charge.kind === 'BUNDLE') {
          await this.deps.bundles.refund(
            {
              subscriptionId: message.charge.subscriptionId,
              bundlePeriodStart: message.charge.bundlePeriodStart,
            },
            now,
          );
        }
        message.fail('ABANDONED', now);
        await this.deps.messages.save(message);
        return true;
      });
      if (done) refunded += 1;
    }
    if (refunded > 0) this.deps.logger.warn({ refunded }, 'stale chat reservations refunded');
    return { refunded };
  }
}
