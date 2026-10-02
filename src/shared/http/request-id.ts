import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestContext } from '../infrastructure/logging/request-context.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts a well-formed inbound X-Request-Id (else generates one), echoes it, and opens the log context. */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    const id = inbound !== undefined && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    requestContext.run({ requestId: id }, next);
  };
}
