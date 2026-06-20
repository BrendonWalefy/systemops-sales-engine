CREATE TYPE "public"."tts_provider" AS ENUM('elevenlabs', 'openai_tts');--> statement-breakpoint
CREATE TABLE "tts_usage_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"provider" "tts_provider" NOT NULL,
	"model" text NOT NULL,
	"character_count" integer NOT NULL,
	"estimated_cost_usd_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tts_usage_costs" ADD CONSTRAINT "tts_usage_costs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tts_usage_costs_clinic_created_at_idx" ON "tts_usage_costs" USING btree ("clinic_id","created_at");
