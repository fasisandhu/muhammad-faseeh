CREATE TYPE "public"."billing_cycle" AS ENUM('MONTHLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('INITIAL', 'RENEWAL');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."subscription_inactive_reason" AS ENUM('PAYMENT_FAILED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('BASIC', 'PRO', 'ENTERPRISE');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payment_status" NOT NULL,
	"provider_reference" text NOT NULL,
	"failure_reason" text,
	"attempted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_subscription_kind_period_uq" UNIQUE("subscription_id","kind","period_start"),
	CONSTRAINT "payments_amount_non_negative" CHECK ("payments"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "subscription_tier" NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"max_messages" integer,
	"used_messages" integer DEFAULT 0 NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"status" "subscription_status" NOT NULL,
	"inactive_reason" "subscription_inactive_reason",
	"auto_renew" boolean NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"renewal_date" timestamp with time zone,
	"renewal_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscriptions_max_messages_positive" CHECK ("subscriptions"."max_messages" IS NULL OR "subscriptions"."max_messages" > 0),
	CONSTRAINT "subscriptions_used_within_limit" CHECK ("subscriptions"."used_messages" >= 0 AND ("subscriptions"."max_messages" IS NULL OR "subscriptions"."used_messages" <= "subscriptions"."max_messages")),
	CONSTRAINT "subscriptions_price_non_negative" CHECK ("subscriptions"."price_cents" >= 0),
	CONSTRAINT "subscriptions_status_reason" CHECK (("subscriptions"."status" = 'ACTIVE') = ("subscriptions"."inactive_reason" IS NULL)),
	CONSTRAINT "subscriptions_period_order" CHECK ("subscriptions"."end_date" >= "subscriptions"."current_period_start")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_attempted_at_idx" ON "payments" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_start_idx" ON "subscriptions" USING btree ("user_id","status","start_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_due_idx" ON "subscriptions" USING btree ("renewal_date") WHERE "subscriptions"."status" = 'ACTIVE' AND "subscriptions"."auto_renew";--> statement-breakpoint
CREATE INDEX "subscriptions_expiry_due_idx" ON "subscriptions" USING btree ("end_date") WHERE "subscriptions"."status" = 'ACTIVE' AND NOT "subscriptions"."auto_renew";