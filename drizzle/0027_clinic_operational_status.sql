CREATE TYPE "public"."clinic_operational_status" AS ENUM('prospect', 'test', 'active', 'paused', 'cancelled');--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "operational_status" "clinic_operational_status" DEFAULT 'prospect' NOT NULL;--> statement-breakpoint
UPDATE "clinics"
SET "operational_status" = CASE
  WHEN "is_test" = true THEN 'test'::"clinic_operational_status"
  WHEN "auto_reply_enabled" = true THEN 'active'::"clinic_operational_status"
  ELSE 'paused'::"clinic_operational_status"
END;
