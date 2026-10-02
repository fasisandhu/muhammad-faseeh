import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { UsageMetrics } from '../../chat/index.js';
import type { SubscriptionMetricsReport } from '../../subscriptions/index.js';

export interface SystemMetrics extends SubscriptionMetricsReport {
  generatedAt: string;
  usage: UsageMetrics;
}

/** Composes each module's own (policy-checked) metrics query; admin owns no data. */
export class GetSystemMetrics {
  constructor(
    private readonly deps: {
      chat: { execute(actor: Actor): Promise<UsageMetrics> };
      subscriptions: { execute(actor: Actor): Promise<SubscriptionMetricsReport> };
      clock: Clock;
    },
  ) {}

  async execute(actor: Actor): Promise<SystemMetrics> {
    const [usage, report] = await Promise.all([
      this.deps.chat.execute(actor),
      this.deps.subscriptions.execute(actor),
    ]);
    return { generatedAt: this.deps.clock.now().toISOString(), usage, ...report };
  }
}
