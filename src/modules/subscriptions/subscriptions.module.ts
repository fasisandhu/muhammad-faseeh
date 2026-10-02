import type { Logger } from '../../shared/application/logger.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/ids.js';
import type { RandomSource } from '../../shared/domain/random.js';
import type { Route } from '../../shared/http/routing.js';
import type { AppConfig } from '../../shared/infrastructure/config/env.js';
import type { DbContext } from '../../shared/infrastructure/db/context.js';
import { BundleQuotaService } from './application/bundle-quota-service.js';
import { CancelSubscription } from './application/cancel-subscription.js';
import { CreateSubscription } from './application/create-subscription.js';
import { GetSubscriptionMetrics } from './application/get-subscription-metrics.js';
import { GetSubscription } from './application/get-subscription.js';
import { ListAllSubscriptions } from './application/list-all-subscriptions.js';
import { ListMySubscriptions } from './application/list-my-subscriptions.js';
import { SetAutoRenew } from './application/set-auto-renew.js';
import { subscriptionRoutes } from './controllers/subscription-routes.js';
import { SimulatedPaymentGateway } from './infrastructure/simulated-payment-gateway.js';
import { DrizzlePaymentRepository } from './repositories/payment-repository.js';
import { DrizzleSubscriptionRepository } from './repositories/subscription-repository.js';

export interface SubscriptionsModuleDeps {
  config: AppConfig;
  db: DbContext;
  clock: Clock;
  ids: IdGenerator;
  random: RandomSource;
  logger: Logger;
}

export interface SubscriptionsModule {
  routes: Route[];
  bundleQuota: BundleQuotaService;
  queries: { metrics: GetSubscriptionMetrics; listAll: ListAllSubscriptions };
}

export function createSubscriptionsModule(deps: SubscriptionsModuleDeps): SubscriptionsModule {
  const subscriptions = new DrizzleSubscriptionRepository(deps.db);
  const payments = new DrizzlePaymentRepository(deps.db);
  const gateway = new SimulatedPaymentGateway({
    failureRate: deps.config.payments.failureRate,
    minLatencyMs: deps.config.payments.minLatencyMs,
    maxLatencyMs: deps.config.payments.maxLatencyMs,
    random: deps.random,
    ids: deps.ids,
  });
  const common = {
    tx: deps.db,
    subscriptions,
    payments,
    gateway,
    clock: deps.clock,
    ids: deps.ids,
    logger: deps.logger,
  };
  return {
    routes: subscriptionRoutes({
      create: new CreateSubscription(common),
      listMine: new ListMySubscriptions(subscriptions),
      get: new GetSubscription(subscriptions),
      setAutoRenew: new SetAutoRenew(common),
      cancel: new CancelSubscription(common),
    }),
    bundleQuota: new BundleQuotaService({ subscriptions, logger: deps.logger }),
    queries: {
      metrics: new GetSubscriptionMetrics({ subscriptions, payments, clock: deps.clock }),
      listAll: new ListAllSubscriptions(subscriptions),
    },
  };
}
