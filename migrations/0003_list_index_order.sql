DROP INDEX "chat_messages_user_created_idx";--> statement-breakpoint
DROP INDEX "subscriptions_user_status_start_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_user_created_idx" ON "chat_messages" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_start_idx" ON "subscriptions" USING btree ("user_id","status","start_date" DESC NULLS FIRST);