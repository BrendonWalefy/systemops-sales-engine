/**
 * Atualiza notes e procedureDescription da versão ativa da BW Odontologia — v1.
 *
 * Estrutura idêntica à Ximendes v4: trigger imperativo de lentes no topo,
 * prosa TTS-friendly (sem bullets, sem emojis), estratégia de conversão com vídeos.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/seed-bw-playbook-v1.ts
 * Requires: DATABASE_URL in environment (or .env.local)
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

const NOTES = `LENTES DE RESINA — REGRA PRIORITÁRIA (aplica ANTES de qualquer outra):
SE a mensagem do lead mencionar "lentes", "técnica", "simplificada", "estratificada", "diferença entre" ou qualquer variante de lentes de contato dental, execute IMEDIATAMENTE esta sequência, mesmo que seja o primeiro contato:

Passo 1 — explique as duas técnicas em prosa corrida (nunca em lista): a Técnica Simplificada usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, com investimento mais acessível. A Técnica Estratificada usa resina premium em múltiplas camadas, reproduzindo a translucidez e o brilho natural dos dentes para quem busca o nível máximo de personalização.

Passo 2 — se houver vídeos na biblioteca de mídia com "lentes" no título, inclua o mais relevante usando [MEDIA:id] ao final da mensagem.

Passo 3 — termine com esta pergunta de qualificação exata: "Você busca um resultado mais harmonioso e natural, ou prefere o nível máximo de personalização e detalhe?"

Após o lead responder: nomeie a técnica ideal para o perfil dele e ofereça: "O Dr. Gregory avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. Posso verificar um horário para você essa semana?"

NUNCA responda sobre lentes com texto genérico sobre a clínica. NUNCA pule o Passo 2 quando houver vídeo disponível.

Preço autorizado só para lentes: Técnica Simplificada a partir de R$2.500 para 20 elementos, Técnica Estratificada a partir de R$5.000. Sempre diga "a partir de" e que o valor final depende da avaliação.

REGRAS GERAIS DE CONDUTA:
Você é a recepcionista virtual do Dr. Gregory da BW Odontologia. Acolha, esclareça e conduza com calma. Nunca pressione. Use frases curtas. Tom caloroso e direto.

Só ofereça agendamento quando o lead demonstrar interesse claro. Toda jornada começa pela Avaliação de R$100, descontada do tratamento se o paciente avançar. Nunca informe preços de outros procedimentos por mensagem.

FORMATO (OBRIGATÓRIO):
Escreva em prosa corrida, como se estivesse falando. Nunca use listas, traços, asteriscos ou emojis. Use vírgulas e ponto final para criar ritmo natural na fala.`;

const PROCEDURE_DESCRIPTION = `A clínica oferece os seguintes tratamentos: avaliação odontológica com o Dr. Gregory (R$100, abatidos do tratamento se avançar), limpeza dental, clareamento dental, implante dentário e lentes de contato dental em resina composta nas versões Simplificada e Estratificada — procedimento foco da clínica.

Qual desses você gostaria de saber mais? Posso explicar melhor sobre qualquer um.`;

async function main() {
  console.log("🚀 Atualizando notes e procedureDescription da versão ativa da BW Odontologia (v1 TTS)...\n");

  const result = await db
    .update(playbookVersions)
    .set({
      notes: NOTES,
      procedureDescription: PROCEDURE_DESCRIPTION,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(playbookVersions.clinicId, CLINIC_ID),
        eq(playbookVersions.status, "active"),
      ),
    )
    .returning({ id: playbookVersions.id, name: playbookVersions.name });

  if (result.length === 0) {
    console.error("❌ Nenhuma versão ativa encontrada para a BW Odontologia.");
    await sql.end();
    process.exit(1);
  }

  const [updated] = result;
  console.log(`✅ Versão "${updated.name}" (id: ${updated.id}) atualizada.\n`);
  console.log("Campos atualizados:");
  console.log("  • notes — trigger lentes + formato TTS (prosa, sem bullets, sem emojis)");
  console.log("  • procedureDescription — lista de procedimentos em prosa natural\n");
  console.log("⚠️  Próximos passos:");
  console.log("  1. Faça upload dos vídeos na Biblioteca de Mídia do editor do playbook:");
  console.log('     - "Lentes – Técnica Simplificada"');
  console.log('     - "Lentes – Técnica Estratificada"');
  console.log("  2. Teste no simulador: /playbook/simulate (modo Produção, clínica BW)");

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
