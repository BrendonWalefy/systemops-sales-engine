ALTER TABLE "clinics" ADD COLUMN "booking_noun" text DEFAULT 'consulta' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "contact_noun" text DEFAULT 'paciente' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "agent_role" text DEFAULT 'recepcionista virtual' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "business_descriptor" text;