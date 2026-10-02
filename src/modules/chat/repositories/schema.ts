import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../shared/infrastructure/db/users-table.js';

export const chatMessageStatus = pgEnum('chat_message_status', ['PENDING', 'COMPLETED', 'FAILED']);
export const quotaChargeKind = pgEnum('quota_charge_kind', ['FREE', 'BUNDLE']);

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const monthlyUsage = pgTable(
  'monthly_usage',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    period: char('period', { length: 7 }).notNull(),
    freeUsed: integer('free_used').notNull().default(0),
    paidUsed: integer('paid_used').notNull().default(0),
    totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.period] }),
    check('monthly_usage_period_format', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'monthly_usage_counts_non_negative',
      sql`${t.freeUsed} >= 0 AND ${t.paidUsed} >= 0 AND ${t.totalTokens} >= 0`,
    ),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    question: text('question').notNull(),
    answer: text('answer'),
    status: chatMessageStatus('status').notNull(),
    chargeKind: quotaChargeKind('charge_kind').notNull(),
    chargePeriod: char('charge_period', { length: 7 }).notNull(),
    // Cross-module reference by id only: no foreign key into the subscriptions module.
    subscriptionId: uuid('subscription_id'),
    bundlePeriodStart: tstz('bundle_period_start'),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    failureCode: text('failure_code'),
    requestId: text('request_id').notNull(),
    latencyMs: integer('latency_ms'),
    createdAt: tstz('created_at').notNull(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    check('chat_messages_question_length', sql`char_length(${t.question}) BETWEEN 1 AND 4000`),
    check(
      'chat_messages_bundle_charge',
      sql`(${t.chargeKind} = 'BUNDLE') = (${t.subscriptionId} IS NOT NULL AND ${t.bundlePeriodStart} IS NOT NULL)`,
    ),
    check(
      'chat_messages_tokens_non_negative',
      sql`coalesce(${t.promptTokens}, 0) >= 0 AND coalesce(${t.completionTokens}, 0) >= 0 AND coalesce(${t.totalTokens}, 0) >= 0`,
    ),
    // DESC NULLS FIRST is what `ORDER BY created_at DESC, id DESC` asks for, so the index can serve the listing.
    index('chat_messages_user_created_idx').on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('chat_messages_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    index('chat_messages_period_idx').on(t.chargePeriod),
  ],
);
