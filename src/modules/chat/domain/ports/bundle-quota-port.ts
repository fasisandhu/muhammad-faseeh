export type BundleConsumeResult =
  | { kind: 'charged'; subscriptionId: string; bundlePeriodStart: Date }
  | { kind: 'none'; activeBundles: number };

export interface BundleSummary {
  subscriptionId: string;
  tier: string;
  remainingMessages: number | null;
  periodEndsAt: Date;
}

/**
 * What chat needs from subscription bundles. Implemented by the subscriptions module and wired in the
 * composition root; calls run inside the caller's ambient transaction.
 */
export interface BundleQuotaPort {
  consumeOne(userId: string, at: Date): Promise<BundleConsumeResult>;
  refund(charge: { subscriptionId: string; bundlePeriodStart: Date }, at: Date): Promise<void>;
  summary(userId: string, at: Date): Promise<BundleSummary[]>;
}
