CREATE TABLE "link_previews" (
	"url" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"image_url" text,
	"ok" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
