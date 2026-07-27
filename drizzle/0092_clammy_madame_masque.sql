CREATE TABLE "decision_traces" (
	"turn_id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid,
	"events" jsonb NOT NULL,
	"first_occurred_at" timestamp with time zone NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_traces" ADD CONSTRAINT "decision_traces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_traces" ADD CONSTRAINT "decision_traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_traces_org_updated_at_idx" ON "decision_traces" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "decision_traces_conversation_updated_at_idx" ON "decision_traces" USING btree ("conversation_id","updated_at");--> statement-breakpoint
CREATE INDEX "decision_traces_expires_at_idx" ON "decision_traces" USING btree ("expires_at");