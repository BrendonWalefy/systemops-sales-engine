CREATE TABLE IF NOT EXISTS "whatsapp_qa_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_clinic_id" uuid NOT NULL,
	"target_clinic_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_qa_routes_source_clinic_id_clinics_id_fk'
	) THEN
		ALTER TABLE "whatsapp_qa_routes" ADD CONSTRAINT "whatsapp_qa_routes_source_clinic_id_clinics_id_fk" FOREIGN KEY ("source_clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_qa_routes_target_clinic_id_clinics_id_fk'
	) THEN
		ALTER TABLE "whatsapp_qa_routes" ADD CONSTRAINT "whatsapp_qa_routes_target_clinic_id_clinics_id_fk" FOREIGN KEY ("target_clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_qa_routes_source_phone_idx" ON "whatsapp_qa_routes" USING btree ("source_clinic_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_qa_routes_target_phone_idx" ON "whatsapp_qa_routes" USING btree ("target_clinic_id","phone");
