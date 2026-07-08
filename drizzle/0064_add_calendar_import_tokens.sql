CREATE TABLE "calendar_import_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_import_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "calendar_import_tokens" ADD CONSTRAINT "calendar_import_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_import_tokens_org_idx" ON "calendar_import_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "calendar_import_tokens_expires_idx" ON "calendar_import_tokens" USING btree ("expires_at");