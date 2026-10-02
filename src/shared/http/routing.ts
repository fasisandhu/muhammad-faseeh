import type { Request, RequestHandler, Response, Router } from 'express';
import type { ZodType } from 'zod';
import type { Actor, Role } from '../domain/actor.js';
import type { AuthContext } from '../domain/auth-context.js';
import { ForbiddenError } from '../domain/errors.js';
import { HttpError } from './problem.js';
import { parseInput } from './validation.js';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export interface RouteAccess {
  readonly roles: readonly Role[];
}

export interface RouteSchemas<P, Q, B> {
  params?: ZodType<P>;
  query?: ZodType<Q>;
  body?: ZodType<B>;
}

export interface HandlerContext<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  auth: AuthContext;
  actor: Actor;
  requestId: string;
  signal: AbortSignal;
}

export interface HttpResult {
  status: number;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
}

export interface RouteDefinition<P, Q, B> {
  method: HttpMethod;
  /** Path relative to /api/v1, e.g. "/chat/messages/:id". */
  path: string;
  summary: string;
  access: RouteAccess;
  schemas?: RouteSchemas<P, Q, B>;
  handler: (ctx: HandlerContext<P, Q, B>) => Promise<HttpResult>;
}

/** A route as data. It cannot exist without an access rule, so "forgot to protect it" is unrepresentable. */
export interface Route {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly access: RouteAccess;
  handle(req: Request, res: Response): Promise<void>;
}

export function defineRoute<P = undefined, Q = undefined, B = undefined>(
  def: RouteDefinition<P, Q, B>,
): Route {
  if (def.access.roles.length === 0) {
    throw new Error(`Route ${def.method.toUpperCase()} ${def.path} must allow at least one role`);
  }
  const label = `${def.method.toUpperCase()} ${def.path}`;
  return {
    method: def.method,
    path: def.path,
    summary: def.summary,
    access: def.access,
    async handle(req, res) {
      const auth = res.locals.auth;
      if (!auth)
        throw new HttpError('UNAUTHENTICATED', 'Authentication is required.', { challenge: 'missing' });
      if (!auth.actor.hasAnyRole(def.access.roles)) throw new ForbiddenError(`call ${label}`);
      const input = parseInput(req, def.schemas ?? {});
      const result = await def.handler({
        params: input.params as P,
        query: input.query as Q,
        body: input.body as B,
        auth,
        actor: auth.actor,
        requestId: res.locals.requestId,
        signal: res.locals.abortSignal,
      });
      if (res.headersSent) return;
      if (result.headers) res.set(result.headers);
      if (result.body === undefined) {
        res.status(result.status).end();
      } else {
        res.status(result.status).json(result.body);
      }
    },
  };
}

export function mountRoutes(router: Router, routes: readonly Route[]): void {
  for (const route of routes) {
    const handler: RequestHandler = (req, res) => route.handle(req, res);
    switch (route.method) {
      case 'get':
        router.get(route.path, handler);
        break;
      case 'post':
        router.post(route.path, handler);
        break;
      case 'patch':
        router.patch(route.path, handler);
        break;
      case 'delete':
        router.delete(route.path, handler);
        break;
    }
  }
}
