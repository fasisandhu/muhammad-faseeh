import type { Actor } from '../../../shared/domain/actor.js';
import { defineRoute, type Route } from '../../../shared/http/routing.js';
import type { BillingRunSummary } from '../../subscriptions/index.js';

const ADMINS = { roles: ['admin'] } as const;

export interface AdminUseCases {
  runBilling: { execute(actor: Actor): Promise<BillingRunSummary> };
}

export function adminRoutes(uc: AdminUseCases): Route[] {
  return [
    defineRoute({
      method: 'post',
      path: '/admin/billing-runs',
      summary: 'Process due renewals and expiries now',
      access: ADMINS,
      handler: async ({ actor }) => ({ status: 200, body: { data: await uc.runBilling.execute(actor) } }),
    }),
  ];
}
