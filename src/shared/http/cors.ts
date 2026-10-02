import type { RequestHandler } from 'express';
import { HttpError } from './problem.js';

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE';
const ALLOWED_HEADERS = 'Authorization, DPoP, Content-Type, X-Request-Id';
const EXPOSED_HEADERS =
  'X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, WWW-Authenticate';

/** Exact-match origin allowlist. Unknown browser origins are rejected outright; non-browser clients send no Origin. */
export function corsPolicy(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin === undefined) {
      next();
      return;
    }
    res.vary('Origin');
    if (!allowed.has(origin)) {
      next(new HttpError('CORS_ORIGIN_DENIED', 'This origin is not allowed to call the API.'));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
