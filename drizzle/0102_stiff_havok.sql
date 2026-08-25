CREATE TABLE "conversation_runtime_control" (
	"key" text PRIMARY KEY NOT NULL,
	"live_outbound_enabled" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "conversation_runtime_control_global_key_check" CHECK ("conversation_runtime_control"."key" = 'global'),
	CONSTRAINT "conversation_runtime_control_version_check" CHECK ("conversation_runtime_control"."version" >= 1)
);
