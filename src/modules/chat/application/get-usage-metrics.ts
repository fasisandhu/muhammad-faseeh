import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import { ChatAccessPolicy } from '../domain/policies/chat-access-policy.js';
import type { ChatMessageRepository, UsageMetrics } from '../domain/ports/chat-message-repository.js';
import { UsagePeriod } from '../domain/value-objects/usage-period.js';

export class GetUsageMetrics {
  constructor(private readonly deps: { messages: ChatMessageRepository; clock: Clock }) {}

  execute(actor: Actor): Promise<UsageMetrics> {
    if (!ChatAccessPolicy.canListAll(actor)) throw new ForbiddenError('read usage metrics');
    return this.deps.messages.usageMetrics(UsagePeriod.of(this.deps.clock.now()));
  }
}
