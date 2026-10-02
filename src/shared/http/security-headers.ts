import type { RequestHandler } from 'express';
import helmet from 'helmet';

export function securityHeaders(): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      xFrameOptions: { action: 'deny' },
    }),
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  ];
}
