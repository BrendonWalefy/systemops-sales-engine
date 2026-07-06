import { db } from "./src/infrastructure/db/client";
import { organizations } from "./src/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { buildCorpus } from "./src/application/setup-study/build-corpus";
import { callAdvisorLLM, SETUP_STUDY_MODEL } from "./src/infrastructure/llm/advisor-llm";

async function main() {
  const clinics = await db.select().from(organizations).where(eq(organizations.name, "Clínica Vitalli"));
  const clinic = clinics[0];

  const corpus = await buildCorpus(clinic.id);
  console.log("Corpus size:", corpus.text.length);
  
  // Build prompt directly
  const prompt = `Você é um Engenheiro de IA configurando o sistema para uma clínica.
O sistema desta clínica precisa ser configurado (Playbook, Tratamentos, Políticas). Seu trabalho é ler as conversas reais abaixo e EXTRAIR as regras de negócio, preços, serviços, tom de voz e objeções para preencher o setup do sistema.

PERÍODO: ${corpus.periodStart.toISOString().slice(0, 10)} a ${corpus.periodEnd.toISOString().slice(0, 10)}
CONVERSAS: ${corpus.conversationCount}
MENSAGENS: ${corpus.totalMessages}

TRANSCRITOS:
${corpus.text}

Retorne um JSON com a estrutura abaixo. Máximo de 15 apontamentos.
Para cada regra de negócio importante descoberta (um preço de serviço, uma política de agendamento, uma objeção que o atendente sempre contorna, ou o tom de voz predominante), crie um apontamento.

Cada finding deve ter:
- category: "price" | "communication" | "qualification" | "policy" | "tone" | "other"
- claim: afirmação clara sobre a regra ou dado descoberto (máx 280 chars, em português)
- evidence: trecho exato do transcript que comprova a descoberta (máx 400 chars)
- severity: 1 (baixa, ex: tom de voz), 2 (média, ex: qualificação), 3 (alta, ex: preço e serviços)
- proposedChange: null | { target: string, newValue: string, currentValue: "" }
  Targets válidos: treatment:<uuid>.priceCents, treatment:<uuid>.priceQuotableInChat,
  treatment:<uuid>.aliases, treatment:<uuid>.requiresEvaluationFirst,
  playbook.objections[], playbook.toneOfVoice, playbook.commercialPolicy, playbook.notes

Seja proativo: se descobrir que a clínica faz "Clareamento por R$800", crie um apontamento para isso. Se descobrir que eles usam muitos emojis e linguagem informal, crie um apontamento de tom de voz.
Se não conseguir mapear para um "target" exato, use proposedChange: null, mas NÃO deixe de criar o finding.

Formato de resposta (JSON apenas, sem markdown):
{
  "findings": [
    {
      "category": "price",
      "claim": "A clínica cobra R$ 150 pela avaliação inicial.",
      "evidence": "CLINICA: O valor da nossa consulta de avaliação é R$ 150. [trecho relevante]",
      "severity": 3,
      "proposedChange": null
    }
  ]
}`;

  console.log("Calling Claude...");
  const raw = await callAdvisorLLM(prompt, { model: SETUP_STUDY_MODEL, maxTokens: 4000 });
  
  console.log("=== RAW CLAUDE OUTPUT ===");
  console.log(raw);
  console.log("=========================");

  process.exit(0);
}

main().catch(console.error);
