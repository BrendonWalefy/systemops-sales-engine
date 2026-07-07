CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"treatment_id" uuid,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"type" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"folder" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD COLUMN "media_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_org_idx" ON "media_assets" USING btree ("organization_id");--> statement-breakpoint
-- ─── Backfill: promove media_library (jsonb legado em playbook_versions) para
-- a tabela media_assets, PRESERVANDO os ids originais — nenhuma referência em
-- pipeline_steps ou media_asset_ids precisa ser reescrita. Idempotente
-- (ON CONFLICT DO NOTHING); pode ser reexecutado com segurança.
--
-- Prioridade em caso de id colidir entre clínicas (ex.: demo semeada com
-- objetos da Ximendes): Ximendes vence, depois versão ativa, depois mais
-- recente. DISTINCT ON mantém só a primeira linha por id após essa ordenação.
INSERT INTO "media_assets" ("id", "organization_id", "title", "url", "type", "created_at", "updated_at")
SELECT DISTINCT ON (elem->>'id')
  (elem->>'id')::uuid,
  pv."organization_id",
  COALESCE(NULLIF(trim(elem->>'title'), ''), 'Sem título'),
  elem->>'url',
  CASE WHEN elem->>'type' IN ('video', 'image') THEN elem->>'type' ELSE 'image' END,
  now(),
  now()
FROM "playbook_versions" pv
CROSS JOIN LATERAL jsonb_array_elements(pv."media_library") AS elem
WHERE jsonb_typeof(pv."media_library") = 'array'
  AND elem->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND elem->>'url' IS NOT NULL
  AND trim(elem->>'url') <> ''
ORDER BY
  elem->>'id',
  (SELECT o.slug = 'ximendes' FROM "organizations" o WHERE o.id = pv."organization_id") DESC NULLS LAST,
  pv.status = 'active' DESC,
  pv."created_at" DESC
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Popula media_asset_ids de cada versão com os ids do seu próprio
-- media_library que efetivamente existem em media_assets NA MESMA
-- ORGANIZAÇÃO (join com organization_id fecha o vazamento entre tenants
-- mesmo se um id tiver colidido acima e "vencido" para outra clínica).
UPDATE "playbook_versions" pv
SET "media_asset_ids" = COALESCE((
  SELECT jsonb_agg(DISTINCT ma.id)
  FROM jsonb_array_elements(pv."media_library") AS elem
  JOIN "media_assets" ma
    ON ma.id = (elem->>'id')::uuid
   AND ma."organization_id" = pv."organization_id"
  WHERE elem->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), '[]'::jsonb)
WHERE jsonb_typeof(pv."media_library") = 'array'
  AND jsonb_array_length(pv."media_library") > 0;
--> statement-breakpoint
-- Cinto e suspensório: se este backfill (ou uma futura edição dele) produzir
-- uma referência cross-tenant, a migração falha alto em vez de deployar um
-- vazamento silencioso.
DO $$
DECLARE
  leak_count integer;
BEGIN
  SELECT count(*) INTO leak_count
  FROM "playbook_versions" pv
  CROSS JOIN LATERAL jsonb_array_elements_text(pv."media_asset_ids") AS asset_id
  JOIN "media_assets" ma ON ma.id = asset_id::uuid
  WHERE ma."organization_id" <> pv."organization_id";

  IF leak_count > 0 THEN
    RAISE EXCEPTION 'media_asset_ids backfill produziu % referência(s) cross-tenant — abortando migração', leak_count;
  END IF;
END $$;