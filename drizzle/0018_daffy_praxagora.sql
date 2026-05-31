CREATE TYPE "public"."playbook_version_status" AS ENUM('active', 'draft', 'historical');--> statement-breakpoint
CREATE TABLE "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "playbook_version_status" DEFAULT 'draft' NOT NULL,
	"specialty" text,
	"procedure_description" text,
	"tone_of_voice" text DEFAULT 'acolhedor' NOT NULL,
	"differentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commercial_policy" text,
	"objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playbook_versions_clinic_status_idx" ON "playbook_versions" USING btree ("clinic_id","status");