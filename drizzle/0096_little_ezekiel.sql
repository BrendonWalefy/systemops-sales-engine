CREATE TABLE "clinic_read_versions" (
	"organization_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_read_versions_organization_id_resource_pk" PRIMARY KEY("organization_id","resource")
);
--> statement-breakpoint
ALTER TABLE "clinic_read_versions" ADD CONSTRAINT "clinic_read_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;