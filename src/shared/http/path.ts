import type { Request } from 'express';

/** The request path without query string — safe to echo in problem documents and logs. */
export const pathOf = (req: Request): string => req.originalUrl.split('?')[0] ?? '/';
