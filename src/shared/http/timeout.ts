import type { RequestHandler } from 'express';
import { pathOf } from './path.js';
import { buildProblem, sendProblem } from './problem.js';

/**
 * Global request deadline. On expiry it answers 503 (if nothing was sent yet) and aborts `res.locals.abortSignal`
 * so downstream work — e.g. the LLM call — stops and compensates. A client disconnect aborts the signal too.
 */
export function requestTimeout(timeoutMs: number): RequestHandler {
  return (req, res, next) => {
    const controller = new AbortController();
    res.locals.abortSignal = controller.signal;
    const timer = setTimeout(() => {
      controller.abort(new Error('request deadline exceeded'));
      sendProblem(
        res,
        buildProblem(
          'REQUEST_TIMEOUT',
          `The request did not complete within ${timeoutMs} ms.`,
          pathOf(req),
          res.locals.requestId,
        ),
      );
    }, timeoutMs);
    timer.unref();
    res.on('finish', () => {
      clearTimeout(timer);
    });
    res.on('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) controller.abort(new Error('client closed the connection'));
    });
    next();
  };
}
