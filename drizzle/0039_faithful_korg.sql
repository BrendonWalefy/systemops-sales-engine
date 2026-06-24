CREATE TABLE "platform_spend_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"team_id" text NOT NULL,
	"budget_amount_usd" integer NOT NULL,
	"current_spend_usd" integer NOT NULL,
	"threshold_percent" integer NOT NULL,
	"event_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_spend_alerts_provider_received_at_idx" ON "platform_spend_alerts" USING btree ("provider","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_spend_alerts_event_key_idx" ON "platform_spend_alerts" USING btree ("event_key");