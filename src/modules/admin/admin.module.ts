import type { Clock } from '../../shared/domain/clock.js';
import type { Route } from '../../shared/http/routing.js';
import { messageDto, type ChatModule } from '../chat/index.js';
import { statusFilter, subscriptionDto, type SubscriptionsModule } from '../subscriptions/index.js';
import { GetSystemMetrics } from './application/get-system-metrics.js';
import { adminRoutes } from './controllers/admin-routes.js';

export interface AdminModuleDeps {
  subscriptions: SubscriptionsModule;
  chat: ChatModule;
  clock: Clock;
}

/** System-wide operations; owns no tables and talks to other modules only through their public APIs. */
export function createAdminModule(deps: AdminModuleDeps): { routes: Route[] } {
  return {
    routes: adminRoutes({
      runBilling: deps.subscriptions.billing,
      metrics: new GetSystemMetrics({
        chat: deps.chat.queries.usageMetrics,
        subscriptions: deps.subscriptions.queries.metrics,
        clock: deps.clock,
      }),
      listMessages: deps.chat.queries.listAll,
      listSubscriptions: deps.subscriptions.queries.listAll,
      messageDto,
      subscriptionDto,
      statusFilter,
    }),
  };
}
