#!/usr/bin/env tsx
/**
 * Harness de replay conversacional — Fase 4 do plano de excelência conversacional
 * (docs/product/plano-excelencia-conversacional.md).
 *
 * Roda o pipeline REAL de produção (IntentClassifier → coerceBusinessIntent →
 * ação → ResponseComposer, mesma IA do WhatsApp) contra mensagens reais/típicas
 * de leads — começando pelos padrões de falha da auditoria jul/2026 (base
 * Ximendes). Imprime a conversa para avaliação de tom contra o padrão-ouro da
 * demo curada e roda checks determinísticos (intent certo, sem saudação
 * genérica por cima de pergunta de negócio).
 *
 * Uso:
 *   npm run replay:conversas                      # clínica default (ximendes)
 *   npm run replay:conversas -- --clinic <slug>   # qualquer clínica do banco
 *
 * Requer .env.local com DATABASE_URL e OPENAI_API_KEY (DISABLE_REAL_OPENAI
 * não pode estar "true" — o objetivo é ver o comportamento real de produção).
 * Não grava nada no banco: apenas lê config e compõe respostas.
 */
import "dotenv/config";
import { ilike, or } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "../src/application/config/editorial-config";
import { DrizzleTreatmentRepository } from "../src/infrastructure/repositories/drizzle-treatment-repository";
import { IntentClassifier, type IntentType } from "../src/core/intelligence/IntentClassifier";
import { ResponseComposer, type ActionResult } from "../src/core/intelligence/ResponseComposer";
import { coerceBusinessIntent } from "../src/core/pipeline/ConversationOrchestrator";
import { buildPromptContext } from "../src/core/intelligence/PromptContextBuilder";
import { buildDemoSlots } from "../src/application/demo/generate-demo-conversation";
import { ClinicTimezone } from "../src/core/scheduling/ClinicTimezone";
import { inferReceptionistNameFromGreeting } from "../src/core/intelligence/receptionist-name";
import type { Message } from "../src/domain/entities/conversation";

type ReplayCase = {
  name: string;
  source: string; // lead real / padrão da auditoria que motivou o caso
  messages: string[];
  // Checks determinísticos: intent final esperado (após coerção) por mensagem (opcional)
  expectIntent?: (IntentType | null)[];
};

// Casos extraídos das 62 conversas reais da Ximendes (auditoria jul/2026).
// Frases idênticas ou muito próximas às originais dos leads.
const CASES: ReplayCase[] = [
  {
    name: "Pergunta de custo na abertura (F1)",
    source: "Tania 23/06 — recebeu saudação genérica no lugar do preço",
    messages: ["Olá! Posso ter mais informações sobre custo?"],
    expectIntent: ["price_inquiry"],
  },
  {
    name: "Pergunta de valores direta (F1)",
    source: "Julllys 15/06 — preço nunca veio; lead lost",
    messages: ["E qual seria os valores?"],
    expectIntent: ["price_inquiry"],
  },
  {
    name: "Paciente na porta (F8)",
    source: "Carla 23/06 — áudio 'estou aqui na frente mas ninguém atende'",
    messages: ["estou aqui na frente mas ninguém atende"],
    expectIntent: ["patient_arrived"],
  },
  {
    name: "Objeção de preço com âncora social (F6)",
    source: "Tania 07/06 — 'minha amiga pagou 1.800 nas 20' ficou 17 dias no vácuo",
    messages: [
      "Quanto ficam as lentes?",
      "Nossa, achei um pouco caro... minha amiga fez por menos em outra clínica",
    ],
    expectIntent: ["price_inquiry", null],
  },
  {
    name: "Negação de tratamento (F3)",
    source: "Tarcisio 30/06 — negou lentes 2x e a IA insistiu em lentes",
    messages: ["Não é lentes que eu quero, queria saber sobre prótese"],
    expectIntent: [null],
  },
  {
    name: "Lead esfriando (padrão follow-up)",
    source: "Ricardo (demo) / vários leads waiting_response",
    messages: ["Quanto custa o implante?", "Hmm entendi. Vou pensar e te falo, ok?"],
    expectIntent: ["price_inquiry", null],
  },
  {
    name: "Contexto emocional + ocasião (padrão-ouro demo)",
    source: "Camila (demo curada) — noiva com medo de sorriso artificial",
    messages: [
      "Oi! Vou me casar em outubro e queria muito melhorar meu sorriso, vocês fazem lentes?",
      "Só tenho medo de ficar com aquele sorriso artificial, sabe?",
    ],
    expectIntent: [null, null],
  },
];

const GENERIC_STARTER_MARKERS = [
  "o que você gostaria de ver hoje",
  "valores, agendamento ou algum serviço",
];

async function main() {
  if (process.env.DISABLE_REAL_OPENAI === "true") {
    throw new Error("DISABLE_REAL_OPENAI=true — o replay exige a IA real de produção.");
  }
  const slugArg = process.argv.indexOf("--clinic");
  const slug = slugArg > -1 ? process.argv[slugArg + 1] : "ximendes";

  const [clinic] = await db
    .select()
    .from(organizations)
    .where(or(ilike(organizations.slug, `%${slug}%`), ilike(organizations.name, `%${slug}%`)))
    .limit(1);
  if (!clinic) throw new Error(`Clínica "${slug}" não encontrada`);

  const editorial = await resolveActiveEditorialConfig(clinic.id);
  const treatments = await new DrizzleTreatmentRepository().listByClinic(clinic.id);
  const promptContext = buildPromptContext(clinic);
  const timezone = new ClinicTimezone(clinic.timezone);
  const classifier = new IntentClassifier();
  const composer = new ResponseComposer();
  const slots = buildDemoSlots();
  const treatmentOptions = treatments.map((t) => ({ name: t.name, aliases: t.aliases ?? undefined }));

  console.log(`\n══ Replay conversacional — ${clinic.name} ══`);
  console.log(`   playbook ativo: ${editorial ? "sim" : "NÃO (respostas vão sair vagas)"} · tratamentos: ${treatments.length}\n`);

  let failures = 0;

  for (const c of CASES) {
    console.log(`\n─── ${c.name}`);
    console.log(`    fonte: ${c.source}`);
    const history: Message[] = [];
    let i = 0;

    for (const [msgIndex, msg] of c.messages.entries()) {
      history.push({
        id: `replay-${i++}`, conversationId: "replay", author: "lead", body: msg,
        sentAt: new Date(), externalId: null,
      });
      console.log(`\n  Lead: ${msg}`);

      const classification = await classifier.classify(msg, history, false, treatmentOptions, promptContext);
      const finalIntent = coerceBusinessIntent({
        message: msg,
        intent: classification.intent,
        treatments,
        isClinicSegment: promptContext.isClinicSegment,
      });
      const coerced = finalIntent !== classification.intent ? ` (coagido de ${classification.intent})` : "";
      console.log(`  [intent: ${finalIntent}${coerced}]`);

      const expected = c.expectIntent?.[msgIndex] ?? null;
      if (expected && finalIntent !== expected) {
        failures++;
        console.log(`  ❌ CHECK: intent esperado era "${expected}"`);
      }

      const action: ActionResult = mapToAction(finalIntent, classification, clinic.name, slots);
      const composed = await composer.compose({
        actionResult: action,
        conversationHistory: history,
        clinic: {
          name: clinic.name,
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
          receptionistName:
            editorial?.receptionistName ??
            inferReceptionistNameFromGreeting(clinic.greetingMessage) ??
            undefined,
        },
        context: promptContext,
        leadName: null,
        timezone,
        isFirstMessage: history.filter((m) => m.author === "agent").length === 0,
        conversationExperience: "concierge",
      });

      const reply = composed.text.trim();
      console.log(`  IA:   ${reply.replace(/\n/g, "\n        ")}`);
      history.push({
        id: `replay-${i++}`, conversationId: "replay", author: "agent", body: reply,
        sentAt: new Date(), externalId: null,
      });

      const generic = GENERIC_STARTER_MARKERS.some((m) => reply.toLowerCase().includes(m));
      if (generic) {
        failures++;
        console.log("  ❌ CHECK: resposta caiu no starter genérico por cima da mensagem do lead");
      }
    }
  }

  console.log(`\n══ Resultado: ${failures === 0 ? "✅ checks determinísticos OK" : `❌ ${failures} check(s) falharam`} ══`);
  console.log("   Tom: avaliar manualmente contra src/application/demo/demo-conversation-scripts.ts (padrão-ouro).\n");
  process.exit(failures === 0 ? 0 : 1);
}

// Espelho compacto do Orchestrator para o harness (mesma abordagem do gerador
// de conversas da demo). Ações determinísticas de agenda usam slots simulados.
function mapToAction(
  intent: IntentType,
  classification: Awaited<ReturnType<IntentClassifier["classify"]>>,
  clinicName: string,
  slots: ReturnType<typeof buildDemoSlots>,
): ActionResult {
  switch (intent) {
    case "price_inquiry":
      return {
        type: "price_inquiry",
        identifiedTreatment: classification.slotPreference.identifiedTreatment ?? null,
        ambiguousTreatmentMatches: classification.slotPreference.ambiguousTreatmentMatches ?? null,
      };
    case "patient_arrived":
      return { type: "patient_arrived", appointmentTime: null };
    case "clinical_urgency":
      return { type: "clinical_urgency" };
    case "needs_human":
      return { type: "handoff_requested", handoffReason: classification.handoffReason ?? null };
    case "book_appointment":
    case "check_availability":
      return { type: "slots_found", slots, askedForPreference: false };
    case "confirm_slot":
      return { type: "appointment_confirmed", slot: slots[0], clinicName };
    case "greeting":
      return { type: "greeting" };
    case "acknowledgment":
      return { type: "acknowledgment" };
    case "farewell":
      return { type: "farewell" };
    case "unclear":
      return {
        type: "clarification_needed",
        question: classification.clarificationQuestion ?? "Pode me contar um pouco mais?",
      };
    default:
      return {
        type: "general_question",
        clinicContext: "Pergunta geral — responda com base no playbook e na política, sem inventar dados.",
      };
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
