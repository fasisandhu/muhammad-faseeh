import { setTimeout as delay } from 'node:timers/promises';

/** Abortable sleep; rejects with the signal's reason when aborted. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  ms <= 0 && !signal?.aborted ? Promise.resolve() : delay(ms, undefined, { signal });
