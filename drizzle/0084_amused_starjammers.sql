CREATE TABLE "short_links" (
	"slug" text PRIMARY KEY NOT NULL,
	"target_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
