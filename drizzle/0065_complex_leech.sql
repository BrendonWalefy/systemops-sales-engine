CREATE TABLE "price_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"treatment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer,
	"min_price_cents" integer,
	"max_price_cents" integer,
	"price_kind" text DEFAULT 'from' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_campaigns" ADD CONSTRAINT "price_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_campaigns" ADD CONSTRAINT "price_campaigns_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_campaigns_org_treatment_idx" ON "price_campaigns" USING btree ("organization_id","treatment_id");