#!/usr/bin/env tsx
/**
 * Checklist de segurança da migração da Biblioteca de Mídia — captura um
 * snapshot determinístico das referências de mídia de uma clínica (por
 * padrão, Ximendes) para comparar ANTES e DEPOIS do deploy da migração 0059.
 *
 * O que compara: cada `mediaId` usado em pipeline_steps deve continuar
 * resolvendo para a MESMA url, antes e depois. Isso é o que garante que
 * nenhum vídeo em produção passa a ser omitido silenciosamente ao lead.
 *
 * Run:
 *   npx dotenv -e .env.local -- tsx scripts/dump-media-refs.ts > /tmp/pre.json
 *   ...deploy...
 *   npx dotenv -e .env.local -- tsx scripts/dump-media-refs.ts > /tmp/post.json
 *   diff /tmp/pre.json /tmp/post.json   # deve ser vazio (ou só timestamp)
 *
 * Argumento opcional: slug da clínica (default: ximendes).
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

async function main() {
  const slug = process.argv[2] ?? "ximendes";

  const envPath = new URL("../.env.local", import.meta.url).pathname;
  const env = readFileSync(envPath, "utf-8");
  const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1];
  if (!dbUrl) throw new Error("DATABASE_URL não encontrado no .env.local");

  const sql = neon(dbUrl);

  const clinicRows = await sql`SELECT id, name, slug FROM organizations WHERE slug = ${slug} LIMIT 1`;
  if (clinicRows.length === 0) throw new Error(`Clínica com slug "${slug}" não encontrada`);
  const clinicId = clinicRows[0].id as string;

  // 1. Todo mediaId referenciado em pipeline_steps (fonte determinística — o
  //    que a IA de fato envia via pipeline, independente de seleção livre).
  const treatmentRows = await sql`
    SELECT id, name, pipeline_steps
    FROM treatments
    WHERE organization_id = ${clinicId} AND pipeline_steps IS NOT NULL
  `;
  const pipelineMediaIds = new Set<string>();
  const pipelineRefs: { treatment: string; mediaId: string }[] = [];
  for (const t of treatmentRows) {
    const raw = JSON.stringify(t.pipeline_steps);
    const matches = raw.matchAll(/"mediaId":"([0-9a-f-]{36})"/g);
    for (const m of matches) {
      pipelineMediaIds.add(m[1]);
      pipelineRefs.push({ treatment: t.name as string, mediaId: m[1] });
    }
  }

  // Roda antes E depois da migração 0059 — detecta qual schema está no ar.
  const hasMediaAssetsTable = await sql`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets'
  `;
  const migrated = hasMediaAssetsTable.length > 0;

  // 2. Seleção de mídia de toda versão de playbook (o que a curadoria escolhe).
  //    Pré-migração: media_library (jsonb embutido). Pós: media_asset_ids (ponteiros).
  const versionRows = migrated
    ? await sql`SELECT id, name, status, media_asset_ids FROM playbook_versions WHERE organization_id = ${clinicId}`
    : await sql`SELECT id, name, status, media_library FROM playbook_versions WHERE organization_id = ${clinicId}`;
  const selectedIds = new Set<string>();
  for (const v of versionRows) {
    const ids = migrated
      ? ((v.media_asset_ids as string[] | null) ?? [])
      : ((v.media_library as { id: string }[] | null) ?? []).map((m) => m.id);
    for (const id of ids) selectedIds.add(id);
  }

  // 3. Resolve TODOS os ids referenciados (pipeline + seleção) contra a fonte
  //    de verdade atual — media_assets pós-migração, media_library antes dela.
  const allIds = Array.from(new Set([...pipelineMediaIds, ...selectedIds])).sort();
  let assetById: Map<string, Record<string, unknown>>;
  if (migrated) {
    const assets =
      allIds.length > 0
        ? await sql`SELECT id, title, type, url, treatment_id FROM media_assets WHERE id = ANY(${allIds})`
        : [];
    assetById = new Map(assets.map((a) => [a.id as string, a]));
  } else {
    // Legado: junta o media_library de TODAS as versões (o mesmo id pode
    // aparecer em mais de uma versão com o mesmo conteúdo).
    assetById = new Map();
    for (const v of versionRows) {
      for (const m of (v.media_library as { id: string; title: string; url: string; type: string }[] | null) ?? []) {
        if (!assetById.has(m.id)) assetById.set(m.id, { id: m.id, title: m.title, type: m.type, url: m.url });
      }
    }
  }

  const resolved = allIds.map((id) => {
    const a = assetById.get(id);
    return {
      mediaId: id,
      resolves: Boolean(a),
      title: a?.title ?? null,
      type: a?.type ?? null,
      url: a?.url ?? null,
      treatmentId: a?.treatment_id ?? null,
    };
  });

  const unresolved = resolved.filter((r) => !r.resolves);

  const snapshot = {
    clinic: { id: clinicId, slug, name: clinicRows[0].name },
    schema: migrated ? "post-migration (media_assets)" : "pre-migration (media_library legado)",
    pipelineRefs: pipelineRefs.sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
    playbookVersions: versionRows
      .map((v) => {
        const ids = migrated
          ? ((v.media_asset_ids as string[] | null) ?? [])
          : ((v.media_library as { id: string }[] | null) ?? []).map((m) => m.id);
        return { id: v.id, name: v.name, status: v.status, mediaIds: ids.slice().sort() };
      })
      .sort((a, b) => (a.id as string).localeCompare(b.id as string)),
    // Comparável antes/depois: só id + url + título (o essencial para o lead).
    resolvedMedia: resolved.map(({ mediaId, resolves, title, type, url }) => ({ mediaId, resolves, title, type, url })),
    unresolvedCount: unresolved.length,
  };

  console.log(JSON.stringify(snapshot, null, 2));

  if (unresolved.length > 0) {
    console.error(`\n⚠️  ${unresolved.length} mediaId referenciado(s) NÃO resolvem em media_assets:`);
    for (const u of unresolved) console.error(`   - ${u.mediaId}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
