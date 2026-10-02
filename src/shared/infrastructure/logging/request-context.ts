import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  userId?: string;
}

/** Carries the request id (and, after authentication, the user id) to every log line of a request. */
export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export const currentRequestContext = (): RequestContextStore | undefined => requestContext.getStore();
