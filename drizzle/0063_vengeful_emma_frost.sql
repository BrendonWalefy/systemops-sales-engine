ALTER TABLE "organizations" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'start'::text;--> statement-breakpoint

UPDATE "organizations" SET "plan" = 'start' WHERE "plan" = 'essencial';--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'growth' WHERE "plan" = 'avancado';--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'scale' WHERE "plan" = 'rede';--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'enterprise' WHERE "plan" = 'custom';--> statement-breakpoint

DROP TYPE "public"."org_plan";--> statement-breakpoint
CREATE TYPE "public"."org_plan" AS ENUM('start', 'growth', 'scale', 'enterprise');--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'start'::"public"."org_plan";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DATA TYPE "public"."org_plan" USING "plan"::"public"."org_plan";
