import { describe, expect, it } from 'vitest';
import { Actor } from '../../../../../src/shared/domain/actor.js';
import { Subscription } from '../../../../../src/modules/subscriptions/domain/entities/subscription.js';
import { SubscriptionPolicy } from '../../../../../src/modules/subscriptions/domain/policies/subscription-policy.js';
import { PlanCatalog } from '../../../../../src/modules/subscriptions/domain/services/plan-catalog.js';

const sub = Subscription.purchase({
  id: 's-1',
  userId: 'owner',
  plan: PlanCatalog.get('PRO', 'MONTHLY'),
  autoRenew: true,
  now: new Date('2026-10-02T00:00:00Z'),
  paymentSucceeded: true,
});
const owner = new Actor('owner', 'sub-o', ['user']);
const stranger = new Actor('stranger', 'sub-s', ['user']);
const admin = new Actor('admin', 'sub-a', ['user', 'admin']);
const roleless = new Actor('nobody', 'sub-n', []);

describe('SubscriptionPolicy', () => {
  it('lets users and admins create subscriptions', () => {
    expect(SubscriptionPolicy.canCreate(owner)).toBe(true);
    expect(SubscriptionPolicy.canCreate(roleless)).toBe(false);
  });

  it('lets only the owner or an admin view and manage', () => {
    expect(SubscriptionPolicy.canView(owner, sub)).toBe(true);
    expect(SubscriptionPolicy.canManage(admin, sub)).toBe(true);
    expect(SubscriptionPolicy.canView(stranger, sub)).toBe(false);
    expect(SubscriptionPolicy.canManage(stranger, sub)).toBe(false);
  });

  it('restricts listings and billing runs to admins', () => {
    expect(SubscriptionPolicy.canListAll(admin)).toBe(true);
    expect(SubscriptionPolicy.canListAll(owner)).toBe(false);
    expect(SubscriptionPolicy.canRunBilling(admin)).toBe(true);
    expect(SubscriptionPolicy.canRunBilling(owner)).toBe(false);
  });
});
