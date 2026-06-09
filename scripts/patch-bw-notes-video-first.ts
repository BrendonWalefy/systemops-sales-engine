/**
 * Patch: atualiza o notes da versão ativa da BW Odontologia.
 * Busca os IDs reais dos vídeos da biblioteca e os hardcoda no notes
 * para que o LLM não precise "adivinhar" o ID pelo título.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/patch-bw-notes-video-first.ts
 */

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { playbookVersions } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

type MediaItem = { id: string; title: string; type: string };

function buildNotes(idSimplificada: string, idEstratificada: string): string {
  return `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes de resina composta. Toda conversa sobre lentes tem prioridade máxima e segue a sequência abaixo sem exceção.

TRIGGER DE LENTES — execute SEMPRE que o lead mencionar qualquer referência a lentes ou estética dental: "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta", "faceta de resina", "resina nos dentes", "lente no dente", "lentes de porcelana" ou pedir agendamento relacionado a lentes.

PROIBIÇÕES ABSOLUTAS durante este trigger:
- NÃO mencione preços ou valores de nenhuma técnica — isso vem depois, se o lead perguntar
- NÃO peça foto do sorriso
- NÃO ofereça agendamento nem avaliação antes de concluir o Passo 2
- NÃO combine as duas técnicas em um único parágrafo — cada uma tem seu bloco separado
- NÃO mostre horários disponíveis

FORMATO OBRIGATÓRIO — dois blocos em sequência, nesta ordem exata:

Bloco A — escreva exatamente este texto em prosa: "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo." Na linha seguinte, escreva exatamente: [MEDIA:${idSimplificada}]

Bloco B — escreva exatamente este texto em prosa: "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético." Na linha seguinte, escreva exatamente: [MEDIA:${idEstratificada}]

Após os dois blocos: pergunte "Ficou com mais alguma dúvida sobre as técnicas?" Se o lead tiver dúvidas, responda de forma consultiva. Se não houver dúvidas, pergunte qual o melhor período e ofereça os horários disponíveis com o Dr. Gregorie.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço só ao confirmar agendamento ou se o lead perguntar diretamente.`;
}

async function main() {
  console.log("🔧 Patch: BW Odontologia — notes com IDs reais + PROIBIÇÕES\n");

  // 1. Busca versão ativa e biblioteca de mídia
  const [version] = await db
    .select({ id: playbookVersions.id, name: playbookVersions.name, mediaLibrary: playbookVersions.mediaLibrary })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, CLINIC_ID), eq(playbookVersions.status, "active")))
    .limit(1);

  if (!version) {
    console.error("❌ Nenhuma versão ativa encontrada para BW Odontologia");
    process.exit(1);
  }

  const library = (version.mediaLibrary ?? []) as MediaItem[];
  console.log(`📚 Biblioteca de mídia (${library.length} itens):`);
  library.forEach((m) => console.log(`   • [${m.type}] id="${m.id}" — ${m.title}`));

  // 2. Encontra os vídeos das técnicas
  const simplificada = library.find((m) => m.title.toLowerCase().includes("simplificada"));
  const estratificada = library.find((m) => m.title.toLowerCase().includes("estratificada"));

  if (!simplificada || !estratificada) {
    console.error("❌ Vídeos não encontrados na biblioteca.");
    console.error(`   simplificada: ${simplificada ? simplificada.title : "NÃO ENCONTRADO"}`);
    console.error(`   estratificada: ${estratificada ? estratificada.title : "NÃO ENCONTRADO"}`);
    process.exit(1);
  }

  console.log(`\n✅ Vídeo Simplificada: "${simplificada.title}" → id="${simplificada.id}"`);
  console.log(`✅ Vídeo Estratificada: "${estratificada.title}" → id="${estratificada.id}"\n`);

  // 3. Atualiza notes com IDs hardcodados
  const notes = buildNotes(simplificada.id, estratificada.id);

  await db
    .update(playbookVersions)
    .set({ notes, updatedAt: new Date() })
    .where(eq(playbookVersions.id, version.id));

  console.log(`✅ Notes atualizado: "${version.name}" (${version.id})`);
  console.log(`   → IDs hardcodados: [MEDIA:${simplificada.id}] e [MEDIA:${estratificada.id}]`);
  console.log(`   → PROIBIÇÕES adicionadas: sem preços, sem foto, sem agenda antes do Passo 2`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
