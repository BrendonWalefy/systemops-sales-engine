/**
 * BW Odontologia — adiciona regra de solicitação de foto do sorriso.
 *
 * Quando o lead demonstra dúvida sobre se o resultado se aplicaria
 * ao próprio caso (independente das palavras usadas), a IA convida
 * a enviar uma foto antes de oferecer o agendamento.
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/add-bw-lentes-photo-request.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { playbookVersions } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);
const BW_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

const NOTES = `ESPECIALIDADE DO DR. GREGORIE — LENTES DE RESINA:
O Dr. Gregorie é especialista em lentes de resina composta, o procedimento de referência da clínica. Toda conversa sobre lentes tem prioridade máxima.

TRIGGER DE LENTES — execute SEMPRE que o lead demonstrar qualquer interesse em lentes, citando palavras como "lentes", "técnica", "simplificada", "estratificada", "lentes de contato dental", "faceta", "sorriso", "dentes" em contexto estético, ou solicitar agendamento para lentes. NUNCA mostre horários antes de concluir os dois passos abaixo.

Passo único — apresente as duas técnicas com seus valores e envie os vídeos intercalados, seguindo EXATAMENTE este modelo:
"[Frase de abertura natural]. O primeiro vídeo é da Técnica Simplificada, que usa resina de alta qualidade e entrega um sorriso harmonioso e bonito, a partir de R$ 2.500 para vinte elementos. [MEDIA:3f5354c0-b6bc-460c-9dfe-e6df59517709] O segundo é da Técnica Estratificada, que usa resina premium em múltiplas camadas, reproduzindo a translucidez, a profundidade e o brilho natural dos dentes, a partir de R$ 5.000. [MEDIA:70da6047-75bf-4062-8a20-6c7ef39a8682]"
Adapte o texto com naturalidade ao tom da conversa, mas mantenha a estrutura OBRIGATÓRIA: frase descritiva da Simplificada → [MEDIA:3f5354c0-b6bc-460c-9dfe-e6df59517709] → frase descritiva da Estratificada → [MEDIA:70da6047-75bf-4062-8a20-6c7ef39a8682].
NUNCA inverta a ordem. NUNCA omita um dos vídeos. NUNCA diga que vai "enviar depois" ou "avisar a equipe". NUNCA adicione um parágrafo separado de comparação ou resumo entre as duas técnicas — a descrição de cada técnica já está na frase antes do seu vídeo. Em ambos os casos, o valor exato depende da avaliação presencial.

Após o passo único — ofereça o agendamento da avaliação: "O Dr. Gregorie avalia pessoalmente o seu sorriso e mostra exatamente como ficaria. A avaliação é R$ 100 e esse valor é abatido do tratamento se você avançar. Posso verificar um horário para você essa semana?"

Se o lead já indicou preferência por uma técnica (respondeu "estratificada", "simplificada", "a mais detalhada", etc.) e os vídeos ainda não foram enviados nesta conversa: valide a escolha com uma frase que aquece — algo como "A Estratificada é realmente o topo em personalização, o Dr. Gregorie faz um trabalho impressionante com ela" — e inclua os dois vídeos seguindo o mesmo modelo obrigatório acima — frase descritiva → [MEDIA:3f5354c0-b6bc-460c-9dfe-e6df59517709] → frase descritiva → [MEDIA:70da6047-75bf-4062-8a20-6c7ef39a8682] — para o lead ver o resultado antes de decidir. Em seguida ofereça o agendamento com a menção dos R$ 100.

Se o lead pedir o vídeo explicitamente após já ter recebido: reenvie os dois [MEDIA:3f5354c0-b6bc-460c-9dfe-e6df59517709] [MEDIA:70da6047-75bf-4062-8a20-6c7ef39a8682].

DÚVIDA SOBRE O CASO PESSOAL — SOLICITAÇÃO DE FOTO:
Se o lead demonstrar qualquer dúvida sobre se o resultado se aplicaria ao próprio sorriso — independente das palavras usadas, como "ficaria bom em mim?", "meus dentes são assim", "tenho um caso diferente", "meu dente tem um problema", "funciona pra qualquer sorriso?", ou qualquer variação que indique insegurança sobre o próprio caso —: convide a enviar uma foto com naturalidade, sem pressão: "Manda uma foto do seu sorriso aqui, o Dr. Gregorie já consegue ter uma ideia visual de como ficaria antes mesmo da avaliação." Só ofereça o agendamento depois que a foto for enviada ou se o lead deixar claro que prefere não enviar.

OBJEÇÕES SOBRE LENTES — responda em prosa, sem listas:
Se o lead disser que é caro ou perguntar sobre parcelamento: diga que o investimento depende do número de elementos e da técnica, que na avaliação o Dr. Gregorie monta um plano com valores e parcelamento em até 12 vezes, e que os R$ 100 da avaliação são abatidos do tratamento.
Se o lead comparar resina com porcelana: explique que a resina preserva cem por cento do esmalte, é reversível e tem resultado estético muito próximo da porcelana. Na avaliação o Dr. Gregorie mostra casos dos dois.
Se o lead tiver medo de resultado artificial: explique que o resultado é personalizado em cor, forma e transparência para parecer completamente natural. O Dr. Gregorie tem casos para mostrar.
Se o lead já fez lentes e não gostou: reconheça com empatia, diga que na avaliação ele pode mostrar o que não gostou e o Dr. Gregorie analisa com cuidado antes de propor qualquer solução.

CONDUTA GERAL:
Nunca pressione. Toda jornada começa pela Avaliação de R$ 100, abatida do tratamento se o paciente avançar. Não informe preços de outros procedimentos por mensagem.

FORMATO (OBRIGATÓRIO em toda resposta):
Prosa corrida, como se estivesse falando. Sem listas, traços, asteriscos, emojis ou numeração. Vírgulas e ponto final criam o ritmo natural da fala. O trigger de lentes define sua própria estrutura de parágrafos — siga o modelo obrigatório acima sem acrescentar parágrafos extras.`;

async function main() {
  const [row] = await db
    .select({ id: playbookVersions.id, name: playbookVersions.name })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, BW_ID), eq(playbookVersions.status, "active")));

  if (!row) { console.error("❌ Nenhuma versão ativa encontrada"); process.exit(1); }

  await db
    .update(playbookVersions)
    .set({ notes: NOTES, updatedAt: new Date() })
    .where(eq(playbookVersions.id, row.id));

  console.log(`✅ Notes atualizado: "${row.name}"`);
  console.log("   Regra de foto do sorriso adicionada.");
  console.log("\n⚠️  Teste no simulador: /playbook/simulate → Produção → BW Odontologia");
  console.log('   Lead: "Será que ficaria bom em meu sorriso?" → deve pedir foto antes de oferecer agendamento');
  console.log('   Lead: "Tenho um dente torto, funciona?" → mesmo comportamento');

  await sql.end();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
