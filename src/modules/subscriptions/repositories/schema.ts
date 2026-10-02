import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../shared/infrastructure/db/users-table.js';

export const subscriptionTier = pgEnum('subscription_tier', ['BASIC', 'PRO', 'ENTERPRISE']);
export const billingCycle = pgEnum('billing_cycle', ['MONTHLY', 'YEARLY']);
export const subscriptionStatus = pgEnum('subscription_status', ['ACTIVE', 'INACTIVE']);
export const subscriptionInactiveReason = pgEnum('subscription_inactive_reason', [
  'PAYMENT_FAILED',
  'CANCELLED',
  'EXPIRED',
]);
export const paymentKind = pgEnum('payment_kind', ['INITIAL', 'RENEWAL']);
export const paymentStatus = pgEnum('payment_status', ['SUCCEEDED', 'FAILED']);

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tier: subscriptionTier('tier').notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    maxMessages: integer('max_messages'),
    usedMessages: integer('used_messages').notNull().default(0),
    priceCents: integer('price_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    status: subscriptionStatus('status').notNull(),
    inactiveReason: subscriptionInactiveReason('inactive_reason'),
    autoRenew: boolean('auto_renew').notNull(),
    startDate: tstz('start_date').notNull(),
    currentPeriodStart: tstz('current_period_start').notNull(),
    endDate: tstz('end_date').notNull(),
    renewalDate: tstz('renewal_date'),
    renewalCount: integer('renewal_count').notNull().default(0),
    cancelledAt: tstz('cancelled_at'),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (t) => [
    check('subscriptions_max_messages_positive', sql`${t.maxMessages} IS NULL OR ${t.maxMessages} > 0`),
    check(
      'subscriptions_used_within_limit',
      sql`${t.usedMessages} >= 0 AND (${t.maxMessages} IS NULL OR ${t.usedMessages} <= ${t.maxMessages})`,
    ),
    check('subscriptions_price_non_negative', sql`${t.priceCents} >= 0`),
    check('subscriptions_status_reason', sql`(${t.status} = 'ACTIVE') = (${t.inactiveReason} IS NULL)`),
    check('subscriptions_period_order', sql`${t.endDate} >= ${t.currentPeriodStart}`),
    index('subscriptions_user_status_start_idx').on(t.userId, t.status, t.startDate.desc().nullsFirst()),
    index('subscriptions_renewal_due_idx')
      .on(t.renewalDate)
      .where(sql`${t.status} = 'ACTIVE' AND ${t.autoRenew}`),
    index('subscriptions_expiry_due_idx')
      .on(t.endDate)
      .where(sql`${t.status} = 'ACTIVE' AND NOT ${t.autoRenew}`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: paymentKind('kind').notNull(),
    periodStart: tstz('period_start').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: paymentStatus('status').notNull(),
    providerReference: text('provider_reference').notNull(),
    failureReason: text('failure_reason'),
    attemptedAt: tstz('attempted_at').notNull(),
  },
  (t) => [
    unique('payments_subscription_kind_period_uq').on(t.subscriptionId, t.kind, t.periodStart),
    check('payments_amount_non_negative', sql`${t.amountCents} >= 0`),
    index('payments_attempted_at_idx').on(t.attemptedAt),
  ],
);
