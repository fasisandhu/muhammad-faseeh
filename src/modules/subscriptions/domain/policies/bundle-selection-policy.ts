import type { Subscription } from '../entities/subscription.js';

const byLatestFirst = (a: Subscription, b: Subscription): number =>
  b.startDate.getTime() - a.startDate.getTime() ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);

/**
 * Deduct from the bundle with the latest remaining quota — the most recently started usable
 * bundle that still has messages. Switching to soonest-expiring-first would only change `byLatestFirst`.
 */
export const BundleSelectionPolicy = {
  select(candidates: readonly Subscription[], now: Date): Subscription | null {
    const usable = candidates.filter((s) => s.isUsableAt(now) && s.hasRemainingMessages());
    return usable.toSorted(byLatestFirst)[0] ?? null;
  },
} as const;
