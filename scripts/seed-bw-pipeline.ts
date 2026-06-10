/**
 * BW Odontologia — migração para arquitetura de pipeline declarativo
 *
 * Replica a mesma arquitetura que seed-ximendes-pipeline.ts fez para a Ximendes:
 *
 *  1. Atualiza os 5 treatments com isAesthetic, keywordMatchEnabled, aliases
 *  2. Configura pipelineSteps para "Lentes de resina composta"
 *     (content com 2 vídeos da biblioteca + qa guiado + photo opcional)
 *  3. Simplifica o NOTES do playbook ativo: remove TRIGGER DE LENTES inline
 *     (coberto agora pelo pipeline declarativo — redundante no notes)
 *
 * Pré-requisito: seed-bw-playbook-v4-canonical.ts já executado e
 *               os dois vídeos de lentes carregados na Biblioteca de Mídia
 *               com "simplificada" e "estratificada" no título.
 *
 * Idempotente: pode ser rodado múltiplas vezes sem efeito colateral.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-bw-pipeline.ts
 */

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import type { PipelineStep, ContentBlock } from "../src/domain/entities/treatment";

const { playbookVersions, treatments } = schema;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema });

const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

// ─────────────────────────────────────────────────────────────────────────────
// NOTES simplificado — sem TRIGGER DE LENTES (coberto pelo pipeline)
//
// O que saiu:
//   • "TRIGGER DE LENTES — execute SEMPRE..." (3 passos) → pipelineSteps
//   • "Bloco A, Bloco B..." → content step do pipeline
//   • "Passo 2 — ficou com mais alguma dúvida..." → qa step do pipeline
//   • "PROIBIÇÕES ABSOLUTAS" → gerenciado pelo Orchestrator via pipelineSteps
//
// O que ficou:
//   • Identidade do especialista (referência contextual para o LLM)
//   • Conduta específica da clínica (endereço, abordagem)
// ─────────────────────────────────────────────────────────────────────────────
const NOTES_SIMPLIFICADO = `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes de resina composta. Toda conversa sobre lentes tem prioridade máxima.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço só ao confirmar agendamento ou se o lead perguntar diretamente.`;

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de tratamentos: campos da arquitetura de pipeline declarativo
//
// isAesthetic         → true para procedimentos estéticos visuais
// keywordMatchEnabled → false para nomes genéricos
// aliases             → variações que o lead usa no WhatsApp
// pipeline            → "lentes" = configurar pipelineSteps
// ─────────────────────────────────────────────────────────────────────────────
const TREATMENT_CONFIG: Record<string, {
  isAesthetic: boolean;
  keywordMatchEnabled: boolean;
  aliases: string[];
  pipeline?: "lentes";
}> = {
  "Avaliação odontológica": {
    isAesthetic: false,
    keywordMatchEnabled: false, // nome genérico — match via LLM, não keyword
    aliases: ["avaliação", "consulta", "consulta inicial", "avaliação inicial", "avaliação gratuita"],
  },
  "Lentes de resina composta": {
    isAesthetic: true,
    keywordMatchEnabled: true,
    aliases: [
      "lentes", "lente", "faceta", "facetas", "resina", "lentes de resina",
      "lentes de contato dental", "faceta de resina", "resina nos dentes",
      "lente no dente", "simplificada", "estratificada", "sorriso",
    ],
    pipeline: "lentes",
  },
  "Limpeza dental": {
    isAesthetic: false,
    keywordMatchEnabled: true,
    aliases: ["limpeza", "profilaxia", "raspagem", "tártaro"],
  },
  "Clareamento dental": {
    isAesthetic: true,
    keywordMatchEnabled: true,
    aliases: ["clareamento", "clarear", "branquear", "dentes brancos", "dentes amarelos"],
  },
  "Implante dentário": {
    isAesthetic: false,
    keywordMatchEnabled: true,
    aliases: ["implante", "dente perdido", "pino no dente", "osseointegração"],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline de lentes — montado dinamicamente com os IDs reais da biblioteca
// ─────────────────────────────────────────────────────────────────────────────
function buildLentesPipeline(videoSimplificadaId: string | null, videoEstratificadaId: string | null): PipelineStep[] {
  const contentBlocks: ContentBlock[] = [
    {
      kind: "text",
      content: "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo.",
    },
  ];

  if (videoSimplificadaId) {
    contentBlocks.push({ kind: "media", mediaId: videoSimplificadaId, caption: "Lentes – Técnica Simplificada" });
  }

  contentBlocks.push({
    kind: "text",
    content: "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético.",
  });

  if (videoEstratificadaId) {
    contentBlocks.push({ kind: "media", mediaId: videoEstratificadaId, caption: "Lentes – Técnica Estratificada" });
  }

  return [
    {
      type: "content",
      label: "Apresentar as duas técnicas",
      blocks: contentBlocks,
    },
    {
      type: "qa",
      label: "Tirar dúvidas sobre as técnicas",
      instruction:
        "Responda dúvidas sobre as técnicas com naturalidade. Não mencione preços além do que está na política comercial. Se o lead demonstrar preferência por uma técnica, confirme a escolha com entusiasmo consultivo antes de seguir para agendamento.",
      maxTurns: 10,
    },
    {
      type: "photo",
      label: "Convidar foto do sorriso",
      message:
        "Para que o Dr. Gregorie possa te dar uma recomendação mais personalizada sobre qual técnica combina melhor com o seu sorriso, você poderia nos enviar uma foto?",
      required: false,
    },
    { type: "ask_availability", label: "Perguntar disponibilidade" },
    { type: "offer_slots", label: "Mostrar horários" },
    { type: "book", label: "Confirmar agendamento" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 BW Odontologia — migração para pipeline declarativo\n");

  // 1. Carrega playbook ativo para pegar IDs dos vídeos na biblioteca de mídia
  const activePlaybook = await db.query.playbookVersions.findFirst({
    where: and(
      eq(playbookVersions.clinicId, CLINIC_ID),
      eq(playbookVersions.status, "active"),
    ),
    columns: { id: true, mediaLibrary: true, name: true },
  });

  if (!activePlaybook) {
    console.error("❌ Playbook ativo não encontrado. Rode seed-bw-playbook-v4-canonical.ts primeiro.");
    process.exit(1);
  }

  console.log(`✅ Playbook ativo: "${activePlaybook.name}" (${activePlaybook.id})`);

  type MediaItem = { id: string; title: string; url: string; type: string };
  const mediaLibrary = (activePlaybook.mediaLibrary ?? []) as MediaItem[];

  console.log(`📚 Biblioteca de mídia: ${mediaLibrary.length} item(s)`);
  if (mediaLibrary.length > 0) {
    mediaLibrary.forEach(m => console.log(`   • ${m.title} (${m.id})`));
  }
  console.log("");

  const videoSimplificada = mediaLibrary.find((m) =>
    m.title.toLowerCase().includes("simplificada"),
  );
  const videoEstratificada = mediaLibrary.find((m) =>
    m.title.toLowerCase().includes("estratificada"),
  );

  if (videoSimplificada) {
    console.log(`✅ Vídeo Simplificada: "${videoSimplificada.title}" (${videoSimplificada.id})`);
  } else {
    console.warn("⚠️  Vídeo da Técnica Simplificada não encontrado na biblioteca — pipeline criado sem esse bloco de mídia");
    console.warn("    Upload o vídeo em Configurações → Biblioteca de Mídia com 'simplificada' no título e rode novamente.");
  }

  if (videoEstratificada) {
    console.log(`✅ Vídeo Estratificada: "${videoEstratificada.title}" (${videoEstratificada.id})`);
  } else {
    console.warn("⚠️  Vídeo da Técnica Estratificada não encontrado — pipeline criado sem esse bloco de mídia");
    console.warn("    Upload o vídeo com 'estratificada' no título e rode novamente.");
  }

  console.log("");

  // 2. Carrega treatments existentes
  const existing = await db.query.treatments.findMany({
    where: eq(treatments.clinicId, CLINIC_ID),
    columns: { id: true, name: true },
  });

  const byName = new Map(existing.map((t) => [t.name, t.id]));
  console.log(`📋 ${existing.length} treatments encontrados no banco\n`);

  // 3. Atualiza cada treatment
  for (const [name, cfg] of Object.entries(TREATMENT_CONFIG)) {
    const id = byName.get(name);
    if (!id) {
      console.warn(`  ⚠ "${name}" não encontrado no banco — pulando`);
      continue;
    }

    let pipelineSteps: PipelineStep[] | null = null;
    if (cfg.pipeline === "lentes") {
      pipelineSteps = buildLentesPipeline(
        videoSimplificada?.id ?? null,
        videoEstratificada?.id ?? null,
      );
    }

    await db
      .update(treatments)
      .set({
        isAesthetic: cfg.isAesthetic,
        keywordMatchEnabled: cfg.keywordMatchEnabled,
        aliases: cfg.aliases,
        pipelineSteps: pipelineSteps as PipelineStep[] | null,
        updatedAt: new Date(),
      })
      .where(eq(treatments.id, id));

    const pipelineTag = pipelineSteps ? ` [pipeline: ${pipelineSteps.length} etapas]` : "";
    const aestheticTag = cfg.isAesthetic ? " ✨" : "";
    console.log(`  ✓ ${name}${aestheticTag}${pipelineTag}`);
  }

  // 4. Simplifica NOTES do playbook ativo (remove TRIGGER DE LENTES)
  console.log("\n📝 Atualizando notes do playbook...");
  await db
    .update(playbookVersions)
    .set({ notes: NOTES_SIMPLIFICADO, updatedAt: new Date() })
    .where(eq(playbookVersions.id, activePlaybook.id));

  console.log("  ✓ TRIGGER DE LENTES removido dos notes (coberto pelo pipeline)");
  console.log("  ✓ Conduta e especialidade mantidas");

  // 5. Resumo
  console.log("\n─────────────────────────────────────────────────────");
  console.log("Migração concluída. Nova arquitetura:");
  console.log("  • pipelineSteps   — Lentes de resina: content→qa→photo→slots→book");
  console.log("  • isAesthetic     — 2 tratamentos marcados (lentes, clareamento)");
  console.log("  • aliases         — todos os 5 tratamentos com aliases");
  console.log("  • keywordMatch    — 'Avaliação odontológica' desabilitado (nome genérico)");
  console.log("  • notes           — trigger inline removido (pipeline declarativo assume)");

  if (!videoSimplificada || !videoEstratificada) {
    console.log("\n⚠️  AÇÃO NECESSÁRIA: faça upload dos vídeos faltantes na Biblioteca de Mídia");
    console.log("   e rode este script novamente para preencher os blocos de mídia no pipeline.");
  }

  console.log("\n📋 PROTOCOLO DE TESTE — simulador: /playbook/simulate → Produção → BW Odontologia");
  console.log("  A: 'quero saber sobre lentes'  → pipeline inicia: textos + vídeos + qa");
  console.log("  B: 'quero agendar lentes'      → booking direto (pipeline não bloqueia intenção real)");
  console.log("  C: 'quanto custa a avaliação?' → R$ 100 + abatimento (da política comercial)");
  console.log("  D: 'resina é pior que porcelana?' → objeção em prosa (das objections[])");
  console.log("  E: 'clareamento' ou 'implante'  → modo reativo (sem pipeline — fluxo normal)");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
