ALTER TABLE "clinic_operational_insights" ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'operational';
