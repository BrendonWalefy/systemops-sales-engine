ALTER TABLE "clinic_read_versions" DROP CONSTRAINT "clinic_read_versions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "clinic_read_versions" ADD CONSTRAINT "clinic_read_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;