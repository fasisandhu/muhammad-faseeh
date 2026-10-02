import express, { type Express, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from './shared/infrastructure/config/env.js';
import './shared/http/locals.js';
import { jsonBody } from './shared/http/body-parser.js';
import { contentNegotiation } from './shared/http/content-negotiation.js';
import { corsPolicy } from './shared/http/cors.js';
import { createErrorHandler } from './shared/http/error-handler.js';
import { healthRouter, type HealthChecks } from './shared/http/health.js';
import { httpLogger } from './shared/http/http-logger.js';
import { routeNotFound } from './shared/http/not-found.js';
import {
  globalIpLimiter,
  groupIpLimiter,
  groupUserLimiter,
  type RateLimiterSet,
} from './shared/http/rate-limit.js';
import { requestId } from './shared/http/request-id.js';
import { mountRoutes, type Route } from './shared/http/routing.js';
import { securityHeaders } from './shared/http/security-headers.js';
import { requestTimeout } from './shared/http/timeout.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  health: HealthChecks;
  rateLimiters: RateLimiterSet;
  authenticate: RequestHandler;
  routes: readonly Route[];
}

/** Builds the Express app. The middleware order below is the security pipeline from spec §9.1. */
export function createApp(deps: AppDependencies): Express {
  const { config, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', config.trustProxy);

  app.use(requestId());
  app.use(httpLogger(logger));
  app.use(securityHeaders());
  app.use(corsPolicy(config.corsAllowedOrigins));
  app.use(globalIpLimiter(deps.rateLimiters, logger));
  app.use(requestTimeout(config.http.requestTimeoutMs));
  app.use(contentNegotiation({ maxUrlLength: config.http.maxUrlLength }));
  app.use(jsonBody(config.http.bodyLimitBytes));

  app.use('/health', healthRouter({ token: config.health.token, checks: deps.health }));

  // Every /api request is authenticated before routing, so unknown paths cannot be probed without credentials.
  const api = express.Router();
  api.use(groupIpLimiter(deps.rateLimiters, logger));
  api.use(deps.authenticate);
  api.use(groupUserLimiter(deps.rateLimiters, logger));
  const v1 = express.Router();
  mountRoutes(v1, deps.routes);
  api.use('/v1', v1);
  api.use(routeNotFound);
  app.use('/api', api);

  app.use(routeNotFound);
  app.use(createErrorHandler(logger, { dpopAlgs: config.dpop.allowedAlgs }));
  return app;
}
