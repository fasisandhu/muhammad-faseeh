import type { RequestHandler } from 'express';
import { pathOf } from './path.js';
import { HttpError } from './problem.js';

export const routeNotFound: RequestHandler = (req, _res, next) => {
  next(new HttpError('ROUTE_NOT_FOUND', `No route matches ${req.method} ${pathOf(req)}.`));
};
