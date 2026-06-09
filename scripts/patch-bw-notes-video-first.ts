/**
 * Patch: atualiza o notes da versão ativa da BW Odontologia.
 * Usa output literal como exemplo — o LLM copia o formato em vez de interpretá-lo.
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
- NÃO mencione preços ou valores de nenhuma técnica
- NÃO peça foto do sorriso
- NÃO ofereça agendamento antes de concluir o Passo 2
- NÃO agrupe os [MEDIA:id] no final — cada um vai imediatamente após o texto do seu bloco
- NÃO combine as duas técnicas num único parágrafo sem a tag entre elas

FORMATO OBRIGATÓRIO — reproduza esta estrutura exatamente, inclusive a posição das tags:

A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo.
[MEDIA:${idSimplificada}]
A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético.
[MEDIA:${idEstratificada}]
Ficou com mais alguma dúvida sobre as técnicas?

Passo 2 — aguardar resposta. Se o lead tiver dúvidas, responder de forma consultiva e aguardar nova resposta. Se não houver dúvidas, perguntar qual o melhor período e oferecer os horários disponíveis com o Dr. Gregorie.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço só ao confirmar agendamento ou se o lead perguntar diretamente.`;
}

async function main() {
  console.log("🔧 Patch: BW — notes com output literal intercalado\n");

  const [version] = await db
    .select({ id: playbookVersions.id, name: playbookVersions.name, mediaLibrary: playbookVersions.mediaLibrary })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, CLINIC_ID), eq(playbookVersions.status, "active")))
    .limit(1);

  if (!version) { console.error("❌ Versão ativa não encontrada"); process.exit(1); }

  const library = (version.mediaLibrary ?? []) as MediaItem[];
  const simplificada = library.find((m) => m.title.toLowerCase().includes("simplificada"));
  const estratificada = library.find((m) => m.title.toLowerCase().includes("estratificada"));

  if (!simplificada || !estratificada) {
    console.error("❌ Vídeos não encontrados:", library.map(m => m.title));
    process.exit(1);
  }

  const notes = buildNotes(simplificada.id, estratificada.id);

  await db
    .update(playbookVersions)
    .set({ notes, updatedAt: new Date() })
    .where(eq(playbookVersions.id, version.id));

  console.log(`✅ Notes atualizado: "${version.name}"`);
  console.log(`   → [MEDIA:${simplificada.id}] após Simplificada`);
  console.log(`   → [MEDIA:${estratificada.id}] após Estratificada`);
  console.log(`   → Formato: output literal (não mais instruções em prosa)`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
