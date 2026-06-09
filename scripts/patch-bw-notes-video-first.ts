/**
 * Patch: atualiza o notes da versão ativa da BW Odontologia
 * para o formato vídeo-primeiro intercalado.
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

const NOTES = `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes de resina composta. Toda conversa sobre lentes tem prioridade máxima e segue a sequência abaixo sem exceção.

TRIGGER DE LENTES — execute SEMPRE que o lead mencionar qualquer referência a lentes ou estética dental: "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta", "faceta de resina", "resina nos dentes", "lente no dente", "lentes de porcelana" ou pedir agendamento relacionado a lentes. NUNCA mostre horários antes de concluir os passos abaixo, mesmo quando a ação for de agendamento.

Passo 1 — apresente cada técnica com o vídeo correspondente vindo ANTES da explicação. Dois blocos em sequência:

Bloco A (Técnica Simplificada): escreva [MEDIA:id] usando o id do vídeo da Simplificada (encontre na biblioteca pelo título — deve conter "simplificada"). Imediatamente após, em prosa corrida: "A Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e natural, com investimento mais acessível. É a escolha ideal para quem busca equilíbrio entre resultado e custo."

Bloco B (Técnica Estratificada): escreva [MEDIA:id] usando o id do vídeo da Estratificada (encontre na biblioteca pelo título — deve conter "estratificada"). Imediatamente após, em prosa corrida: "A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes. É para quem deseja o nível máximo de personalização e refinamento estético."

Passo 2 — faça a pergunta de qualificação: "Qual dessas combina mais com o que você busca — um resultado harmonioso e natural, ou personalização máxima com cada detalhe?"

Quando o lead responder: identifique a técnica ideal para o perfil dele e ofereça: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando o lead demonstrar interesse real. Toda jornada começa pela avaliação. O endereço só ao confirmar agendamento ou se o lead perguntar diretamente.`;

async function main() {
  console.log("🔧 Patch: BW Odontologia — notes para formato vídeo-primeiro\n");

  const result = await db
    .update(playbookVersions)
    .set({ notes: NOTES, updatedAt: new Date() })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        eq(playbookVersions.status, "active"),
      ),
    )
    .returning({ id: playbookVersions.id, name: playbookVersions.name });

  if (result.length === 0) {
    console.error("❌ Nenhuma versão ativa encontrada para BW Odontologia");
    process.exit(1);
  }

  console.log(`✅ Notes atualizado: "${result[0].name}" (${result[0].id})`);
  console.log("   → Formato: [MEDIA:id-simplificada] + texto + [MEDIA:id-estratificada] + texto + qualificação");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
