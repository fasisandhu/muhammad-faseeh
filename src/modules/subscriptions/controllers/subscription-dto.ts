import type { Subscription } from '../domain/entities/subscription.js';
import type { Plan } from '../domain/value-objects/plan.js';

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export const subscriptionDto = (s: Subscription) => ({
  id: s.id,
  tier: s.tier,
  billingCycle: s.billingCycle,
  maxMessages: s.maxMessages,
  usedMessages: s.usedMessages,
  remainingMessages: s.remainingMessages(),
  price: { amountCents: s.price.amountCents, currency: s.price.currency },
  status: s.status,
  inactiveReason: s.inactiveReason,
  autoRenew: s.autoRenew,
  startDate: s.startDate.toISOString(),
  currentPeriodStart: s.currentPeriodStart.toISOString(),
  endDate: s.endDate.toISOString(),
  renewalDate: iso(s.renewalDate),
  renewalCount: s.renewalCount,
  cancelledAt: iso(s.cancelledAt),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const planDto = (p: Plan) => ({
  tier: p.tier,
  billingCycle: p.billingCycle,
  maxMessages: p.maxMessages,
  unlimited: p.maxMessages === null,
  price: { amountCents: p.price.amountCents, currency: p.price.currency },
});
