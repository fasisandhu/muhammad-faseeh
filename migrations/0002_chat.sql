CREATE TYPE "public"."chat_message_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."quota_charge_kind" AS ENUM('FREE', 'BUNDLE');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"status" "chat_message_status" NOT NULL,
	"charge_kind" "quota_charge_kind" NOT NULL,
	"charge_period" char(7) NOT NULL,
	"subscription_id" uuid,
	"bundle_period_start" timestamp with time zone,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"failure_code" text,
	"request_id" text NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chat_messages_question_length" CHECK (char_length("chat_messages"."question") BETWEEN 1 AND 4000),
	CONSTRAINT "chat_messages_bundle_charge" CHECK (("chat_messages"."charge_kind" = 'BUNDLE') = ("chat_messages"."subscription_id" IS NOT NULL AND "chat_messages"."bundle_period_start" IS NOT NULL)),
	CONSTRAINT "chat_messages_tokens_non_negative" CHECK (coalesce("chat_messages"."prompt_tokens", 0) >= 0 AND coalesce("chat_messages"."completion_tokens", 0) >= 0 AND coalesce("chat_messages"."total_tokens", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_usage" (
	"user_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"free_used" integer DEFAULT 0 NOT NULL,
	"paid_used" integer DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_usage_user_id_period_pk" PRIMARY KEY("user_id","period"),
	CONSTRAINT "monthly_usage_period_format" CHECK ("monthly_usage"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_usage_counts_non_negative" CHECK ("monthly_usage"."free_used" >= 0 AND "monthly_usage"."paid_used" >= 0 AND "monthly_usage"."total_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_usage" ADD CONSTRAINT "monthly_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_user_created_idx" ON "chat_messages" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_messages_pending_idx" ON "chat_messages" USING btree ("created_at") WHERE "chat_messages"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "chat_messages_period_idx" ON "chat_messages" USING btree ("charge_period");