CREATE TABLE "channel_health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" text NOT NULL,
	"opt_out_count" integer DEFAULT 0 NOT NULL,
	"outbound_sent" integer DEFAULT 0 NOT NULL,
	"outbound_cancelled" integer DEFAULT 0 NOT NULL,
	"outbound_deferred" integer DEFAULT 0 NOT NULL,
	"inbound_received" integer DEFAULT 0 NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "channel_safety_mode" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_health_snapshots" ADD CONSTRAINT "channel_health_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_health_snapshots_org_date_idx" ON "channel_health_snapshots" USING btree ("organization_id","date");