import type { Route } from '../../shared/http/routing.js';
import type { SubscriptionsModule } from '../subscriptions/index.js';
import { adminRoutes } from './controllers/admin-routes.js';

export interface AdminModuleDeps {
  subscriptions: SubscriptionsModule;
}

/** System-wide operations; owns no tables and talks to other modules only through their public APIs. */
export function createAdminModule(deps: AdminModuleDeps): { routes: Route[] } {
  return { routes: adminRoutes({ runBilling: deps.subscriptions.billing }) };
}
