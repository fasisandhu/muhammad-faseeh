import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { currentRequestContext } from '../infrastructure/logging/request-context.js';

/** One "request completed" line per request: requestId, userId, route, status, responseTimeMs (spec §11). */
export function httpLogger(logger: Logger): RequestHandler {
  return pinoHttp<Request, Response>({
    logger,
    genReqId: (_req, res) => res.locals.requestId,
    customAttributeKeys: { responseTime: 'responseTimeMs' },
    customLogLevel: (_req, res, error) =>
      error !== undefined || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
    // requestId (and userId, once the auth middleware records it) come from the logger mixin via the request context;
    // add them here only when the context does not already carry them (e.g. logs emitted outside the request's async
    // context, such as on client abort), to avoid duplicate JSON keys.
    customProps: (req, res) => {
      const context = currentRequestContext();
      return {
        requestId: context === undefined ? res.locals.requestId : undefined,
        userId: context?.userId === undefined ? res.locals.auth?.actor.userId : undefined,
        route: req.route ? `${req.baseUrl}${String((req.route as { path: unknown }).path)}` : undefined,
      };
    },
    serializers: {
      req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url.split('?')[0],
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
