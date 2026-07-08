ALTER TYPE "public"."ai_provider" ADD VALUE 'anthropic';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "zapi_monthly_cost_brl" integer;