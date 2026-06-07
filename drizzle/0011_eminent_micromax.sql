ALTER TABLE "leads" ADD COLUMN "whatsapp_lid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_clinic_whatsapp_lid_idx" ON "leads" USING btree ("clinic_id","whatsapp_lid");