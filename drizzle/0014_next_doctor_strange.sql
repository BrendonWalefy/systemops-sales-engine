CREATE TYPE "public"."clinic_plan" AS ENUM('essencial', 'clinica', 'rede', 'custom');--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "plan" "clinic_plan" DEFAULT 'essencial' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "monthly_revenue_brl" integer DEFAULT 89700 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "billing_started_at" timestamp with time zone;