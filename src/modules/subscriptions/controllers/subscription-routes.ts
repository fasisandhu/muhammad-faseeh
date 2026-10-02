import { z } from 'zod';
import { pageBody } from '../../../shared/http/page.js';
import { defineRoute, type Route } from '../../../shared/http/routing.js';
import { paginationQuery, uuidParam } from '../../../shared/http/validation.js';
import type { CancelSubscription } from '../application/cancel-subscription.js';
import type { CreateSubscription } from '../application/create-subscription.js';
import type { GetSubscription } from '../application/get-subscription.js';
import type { ListMySubscriptions } from '../application/list-my-subscriptions.js';
import type { SetAutoRenew } from '../application/set-auto-renew.js';
import { PlanCatalog } from '../domain/services/plan-catalog.js';
import { BILLING_CYCLES, TIERS } from '../domain/value-objects/tier.js';
import { planDto, subscriptionDto } from './subscription-dto.js';

const USERS = { roles: ['user', 'admin'] } as const;

export const createBody = z.strictObject({
  tier: z.enum(TIERS),
  billingCycle: z.enum(BILLING_CYCLES),
  autoRenew: z.boolean(),
});
export const statusFilter = z.enum(['ACTIVE', 'INACTIVE']);
const listQuery = paginationQuery.extend({ status: statusFilter.optional() });
const patchBody = z.strictObject({ autoRenew: z.boolean() });

export interface SubscriptionUseCases {
  create: CreateSubscription;
  listMine: ListMySubscriptions;
  get: GetSubscription;
  setAutoRenew: SetAutoRenew;
  cancel: CancelSubscription;
}

export function subscriptionRoutes(uc: SubscriptionUseCases): Route[] {
  return [
    defineRoute({
      method: 'get',
      path: '/subscription-plans',
      summary: 'Plan catalog (prices and message allowances are server-defined)',
      access: USERS,
      handler: () => Promise.resolve({ status: 200, body: { data: PlanCatalog.all().map(planDto) } }),
    }),
    defineRoute({
      method: 'post',
      path: '/subscriptions',
      summary: 'Buy a subscription bundle (simulated payment)',
      access: USERS,
      schemas: { body: createBody },
      handler: async ({ actor, body }) => {
        const subscription = await uc.create.execute({ actor, ...body });
        return {
          status: 201,
          headers: { Location: `/api/v1/subscriptions/${subscription.id}` },
          body: { data: subscriptionDto(subscription) },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/subscriptions',
      summary: "List the caller's subscriptions",
      access: USERS,
      schemas: { query: listQuery },
      handler: async ({ actor, query }) => ({
        status: 200,
        body: pageBody(
          await uc.listMine.execute({
            actor,
            status: query.status,
            page: { limit: query.limit, cursor: query.cursor },
          }),
          subscriptionDto,
          query.limit,
        ),
      }),
    }),
    defineRoute({
      method: 'get',
      path: '/subscriptions/:id',
      summary: 'Read one subscription (owner or admin)',
      access: USERS,
      schemas: { params: uuidParam },
      handler: async ({ actor, params }) => ({
        status: 200,
        body: { data: subscriptionDto(await uc.get.execute({ actor, id: params.id })) },
      }),
    }),
    defineRoute({
      method: 'patch',
      path: '/subscriptions/:id',
      summary: 'Enable or disable auto-renew',
      access: USERS,
      schemas: { params: uuidParam, body: patchBody },
      handler: async ({ actor, params, body }) => ({
        status: 200,
        body: {
          data: subscriptionDto(
            await uc.setAutoRenew.execute({ actor, id: params.id, autoRenew: body.autoRenew }),
          ),
        },
      }),
    }),
    defineRoute({
      method: 'post',
      path: '/subscriptions/:id/cancellation',
      summary: 'Cancel: ends the current cycle now, no renewals, history kept',
      access: USERS,
      schemas: { params: uuidParam },
      handler: async ({ actor, params }) => ({
        status: 200,
        body: { data: subscriptionDto(await uc.cancel.execute({ actor, id: params.id })) },
      }),
    }),
  ];
}
