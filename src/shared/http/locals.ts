import type { AuthContext } from '../domain/auth-context.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express declaration merging for res.locals
  namespace Express {
    interface Locals {
      requestId: string;
      abortSignal: AbortSignal;
      auth?: AuthContext;
    }
  }
}

export {};
