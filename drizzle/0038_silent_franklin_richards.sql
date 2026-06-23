ALTER TABLE "conversations" ADD COLUMN "next_outbound_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "sequence" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_conversation_sequence_idx" ON "outbound_messages" USING btree ("conversation_id","sequence");