import { z } from 'zod';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Page, PageRequest } from '../../../shared/domain/pagination.js';
import { pageBody } from '../../../shared/http/page.js';
import { defineRoute, type Route } from '../../../shared/http/routing.js';
import { paginationQuery } from '../../../shared/http/validation.js';
import type { BillingRunSummary } from '../../subscriptions/index.js';
import type { SystemMetrics } from '../application/get-system-metrics.js';

const ADMINS = { roles: ['admin'] } as const;

export interface AdminUseCases<M, S> {
  runBilling: { execute(actor: Actor): Promise<BillingRunSummary> };
  metrics: { execute(actor: Actor): Promise<SystemMetrics> };
  listMessages: { execute(input: { actor: Actor; userId?: string; page: PageRequest }): Promise<Page<M>> };
  listSubscriptions: {
    execute(input: {
      actor: Actor;
      userId?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      page: PageRequest;
    }): Promise<Page<S>>;
  };
  messageDto: (message: M) => unknown;
  subscriptionDto: (subscription: S) => unknown;
  statusFilter: z.ZodType<'ACTIVE' | 'INACTIVE'>;
}

export function adminRoutes<M, S>(uc: AdminUseCases<M, S>): Route[] {
  const byUser = paginationQuery.extend({ userId: z.uuid().optional() });
  const subscriptionQuery = byUser.extend({ status: uc.statusFilter.optional() });
  return [
    defineRoute({
      method: 'get',
      path: '/admin/metrics',
      summary: 'System-wide usage and subscription metrics',
      access: ADMINS,
      handler: async ({ actor }) => ({ status: 200, body: { data: await uc.metrics.execute(actor) } }),
    }),
    defineRoute({
      method: 'get',
      path: '/admin/chat/messages',
      summary: 'All chat messages, optionally for one user',
      access: ADMINS,
      schemas: { query: byUser },
      handler: async ({ actor, query }) => ({
        status: 200,
        body: pageBody(
          await uc.listMessages.execute({
            actor,
            userId: query.userId,
            page: { limit: query.limit, cursor: query.cursor },
          }),
          uc.messageDto,
          query.limit,
        ),
      }),
    }),
    defineRoute({
      method: 'get',
      path: '/admin/subscriptions',
      summary: 'All subscriptions, filterable by user and status',
      access: ADMINS,
      schemas: { query: subscriptionQuery },
      handler: async ({ actor, query }) => ({
        status: 200,
        body: pageBody(
          await uc.listSubscriptions.execute({
            actor,
            userId: query.userId,
            status: query.status,
            page: { limit: query.limit, cursor: query.cursor },
          }),
          uc.subscriptionDto,
          query.limit,
        ),
      }),
    }),
    defineRoute({
      method: 'post',
      path: '/admin/billing-runs',
      summary: 'Process due renewals and expiries now',
      access: ADMINS,
      handler: async ({ actor }) => ({ status: 200, body: { data: await uc.runBilling.execute(actor) } }),
    }),
  ];
}
