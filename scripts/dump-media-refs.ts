#!/usr/bin/env tsx
/**
 * Auditor canônico das referências de mídia de uma clínica (por padrão,
 * Ximendes). Verifica pipelines e seleções de playbook contra `media_assets`.
 *
 * O que compara: cada `mediaId` usado em pipeline_steps deve continuar
 * resolvendo para a MESMA url, antes e depois. Isso é o que garante que
 * nenhum vídeo em produção passa a ser omitido silenciosamente ao lead.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/dump-media-refs.ts ximendes
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

  // 2. Seleção de mídia de toda versão de playbook (o que a curadoria escolhe).
  const versionRows = await sql`
    SELECT id, name, status, media_asset_ids
    FROM playbook_versions
    WHERE organization_id = ${clinicId}
  `;
  const selectedIds = new Set<string>();
  for (const v of versionRows) {
    const ids = (v.media_asset_ids as string[] | null) ?? [];
    for (const id of ids) selectedIds.add(id);
  }

  // 3. Resolve TODOS os ids referenciados contra a única fonte canônica.
  const allIds = Array.from(new Set([...pipelineMediaIds, ...selectedIds])).sort();
  const assets = allIds.length > 0
    ? await sql`
        SELECT id, title, type, url, treatment_id
        FROM media_assets
        WHERE organization_id = ${clinicId} AND id = ANY(${allIds})
      `
    : [];
  const assetById = new Map(assets.map((asset) => [asset.id as string, asset]));

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
    schema: "media_assets",
    pipelineRefs: pipelineRefs.sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
    playbookVersions: versionRows
      .map((v) => {
        const ids = (v.media_asset_ids as string[] | null) ?? [];
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
