#!/usr/bin/env tsx
/**
 * Replay shadow read-only for the latest real lead conversations.
 *
 * Reads production conversations, re-composes answers with the current code,
 * and prints deterministic risk flags. It does not call the orchestrator and
 * does not write or send WhatsApp messages.
 */
import "dotenv/config";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { conversations, leads, messages, organizations } from "../src/infrastructure/db/schema";
import { resolveActiveEditorialConfig } from "../src/application/config/editorial-config";
import { DrizzleTreatmentRepository } from "../src/infrastructure/repositories/drizzle-treatment-repository";
import { IntentClassifier, type IntentType } from "../src/core/intelligence/IntentClassifier";
import { ResponseComposer, resolveComposerModel, type ActionResult } from "../src/core/intelligence/ResponseComposer";
import { coerceBusinessIntent } from "../src/core/pipeline/ConversationOrchestrator";
import { buildPromptContext } from "../src/core/intelligence/PromptContextBuilder";
import { buildDemoSlots } from "../src/application/demo/generate-demo-conversation";
import { ClinicTimezone } from "../src/core/scheduling/ClinicTimezone";
import { inferReceptionistNameFromGreeting } from "../src/core/intelligence/receptionist-name";
import type { Message } from "../src/domain/entities/conversation";

const GENERIC_STARTER_MARKERS = [
  "o que você gostaria de ver hoje",
  "valores, agendamento ou algum serviço",
  "quer que eu te mostre valores, agendamento",
];

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const clinicSlug = argValue("--clinic", "clinica-vitalli");
const leadLimit = Number(argValue("--leads", "8"));
const maxLeadTurns = Number(argValue("--turns", "6"));

type DbMessage = {
  id: string;
  conversationId: string;
  author: "lead" | "clinic_user" | "agent" | "system";
  body: string;
  sentAt: Date;
  externalId: string | null;
  intent: string | null;
  simulated: boolean;
};

function toDomainMessage(m: DbMessage): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    author: m.author,
    body: m.body,
    sentAt: m.sentAt,
    externalId: m.externalId,
    intent: m.intent,
    simulated: m.simulated,
  };
}

function firstReplyAfter(all: DbMessage[], index: number): DbMessage | null {
  for (let i = index + 1; i < all.length; i++) {
    if (all[i].author === "lead") return null;
    if (all[i].author === "agent" || all[i].author === "clinic_user") return all[i];
  }
  return null;
}

function compact(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function questionKind(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(insta|instagram|perfil)\b/.test(lower)) return "instagram";
  if (/\b(endere[cç]o|onde fica|localiza[cç][aã]o|maps|bairro)\b/.test(lower)) return "localizacao";
  if (/\b(valor|pre[cç]o|quanto custa|quanto fica|forma[s]? de pagamento|parcela)\b/.test(lower)) return "preco";
  if (/\b(hor[aá]rio|agenda|marcar|agendar|reservar|consulta|disponibilidade)\b/.test(lower)) return "agenda";
  if (/\b(foto|imagem|qual.*foto|pr[eê]mio|premium|estratificada)\b/.test(lower)) return "midia";
  if (text.includes("?")) return "pergunta";
  return null;
}

function answerCovers(kind: string | null, text: string): boolean {
  if (!kind) return true;
  const lower = text.toLowerCase();
  switch (kind) {
    case "instagram":
      return /instagram|@|perfil/.test(lower);
    case "localizacao":
      return /endere[cç]o|fica|localiza[cç][aã]o|bairro|maps|rua|avenida|av\./.test(lower);
    case "preco":
      return /r\$|valor|pre[cç]o|custa|fica|pagamento|parcela|avalia[cç][aã]o/.test(lower);
    case "agenda":
      return /hor[aá]rio|agenda|dispon[ií]vel|marcar|agendar|consulta|posso ver/.test(lower);
    case "midia":
      return /foto|imagem|pr[eê]mio|premium|estratificada|essa|esta/.test(lower);
    default:
      return text.trim().length >= 20;
  }
}

function repetitionRisk(reply: string, previousReplies: string[]): boolean {
  const normalizedReply = reply.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedReply.length < 80) return false;
  return previousReplies.some((prev) => {
    const normalizedPrev = prev.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalizedPrev.length < 80) return false;
    return normalizedReply.includes(normalizedPrev.slice(0, 120)) ||
      normalizedPrev.includes(normalizedReply.slice(0, 120));
  });
}

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

async function main() {
  if (process.env.DISABLE_REAL_OPENAI === "true") {
    throw new Error("DISABLE_REAL_OPENAI=true blocks this shadow replay.");
  }

  const [clinic] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, clinicSlug))
    .limit(1);
  if (!clinic) throw new Error(`Clinic not found: ${clinicSlug}`);

  const candidates = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadWhatsappLid: leads.whatsappLid,
      treatmentInterest: leads.treatmentInterest,
    })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(and(
      eq(conversations.clinicId, clinic.id),
      eq(conversations.category, "sales"),
      isNotNull(conversations.lastMessageAt),
    ))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(leadLimit * 3);

  const candidateIds = candidates.map((c) => c.id);
  const allMessages = candidateIds.length
    ? await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        author: messages.author,
        body: messages.body,
        sentAt: messages.sentAt,
        externalId: messages.externalId,
        intent: messages.intent,
        simulated: messages.simulated,
      })
      .from(messages)
      .where(inArray(messages.conversationId, candidateIds))
      .orderBy(messages.sentAt)
    : [];

  const byConversation = new Map<string, DbMessage[]>();
  for (const m of allMessages) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m as DbMessage);
    byConversation.set(m.conversationId, list);
  }

  const selected = candidates
    .filter((c) => (byConversation.get(c.id) ?? []).some((m) => m.author === "lead" && m.body.trim()))
    .slice(0, leadLimit);

  const editorial = await resolveActiveEditorialConfig(clinic.id);
  const treatments = await new DrizzleTreatmentRepository().listByClinic(clinic.id);
  const promptContext = buildPromptContext(clinic);
  const timezone = new ClinicTimezone(clinic.timezone);
  const classifier = new IntentClassifier();
  const composer = new ResponseComposer();
  const slots = buildDemoSlots();
  const treatmentOptions = treatments.map((t) => ({ name: t.name, aliases: t.aliases ?? undefined }));

  console.log(`\nReplay shadow read-only — ${clinic.name}`);
  console.log(`Commit/prod code: ${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"} · composer: ${resolveComposerModel(clinic.plan)}`);
  console.log(`Leads: ${selected.length} · max lead turns: ${maxLeadTurns} · playbook ativo: ${editorial ? "sim" : "não"} · tratamentos: ${treatments.length}\n`);

  let turns = 0;
  let genericStarter = 0;
  let ignoredQuestion = 0;
  let repeated = 0;
  let noActualReply = 0;

  for (const [leadIndex, c] of selected.entries()) {
    const msgs = byConversation.get(c.id) ?? [];
    const leadMsgs = msgs
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.author === "lead" && m.body.trim())
      .slice(0, maxLeadTurns);
    const identity = c.leadName?.trim() || c.leadPhone?.slice(-4) || c.leadWhatsappLid?.slice(-6) || c.leadId.slice(0, 8);

    console.log(`\n#${leadIndex + 1} lead=${identity} conv=${c.id.slice(0, 8)} last=${c.lastMessageAt?.toISOString() ?? c.createdAt.toISOString()} interest=${c.treatmentInterest ?? "-"}`);

    const shadowReplies: string[] = [];
    for (const { m, index } of leadMsgs) {
      turns++;
      const history = msgs.slice(0, index + 1).map(toDomainMessage);
      const previousReplies = history
        .filter((h) => h.author === "agent")
        .map((h) => h.body);
      const actual = firstReplyAfter(msgs, index);
      if (!actual) noActualReply++;

      const classification = await classifier.classify(m.body, history, false, treatmentOptions, promptContext);
      const finalIntent = coerceBusinessIntent({
        message: m.body,
        intent: classification.intent,
        treatments,
        isClinicSegment: promptContext.isClinicSegment,
      });
      const action = mapToAction(finalIntent, classification, clinic.name, slots);
      const composed = await composer.compose({
        actionResult: action,
        conversationHistory: history,
        clinic: {
          name: clinic.name,
          plan: clinic.plan,
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
        leadName: c.leadName,
        timezone,
        isFirstMessage: history.filter((h) => h.author === "agent").length === 0,
        conversationExperience: "concierge",
      });

      const shadow = composed.text.trim();
      shadowReplies.push(shadow);
      const kind = questionKind(m.body);
      const isGeneric = GENERIC_STARTER_MARKERS.some((marker) => shadow.toLowerCase().includes(marker));
      const isIgnored = !answerCovers(kind, shadow);
      const isRepeated = repetitionRisk(shadow, [...previousReplies, ...shadowReplies.slice(0, -1)]);

      if (isGeneric) genericStarter++;
      if (isIgnored) ignoredQuestion++;
      if (isRepeated) repeated++;

      const flags = [
        isGeneric ? "starter_generico" : null,
        isIgnored ? `possivel_pergunta_ignorada:${kind}` : null,
        isRepeated ? "possivel_repeticao" : null,
      ].filter(Boolean).join(", ") || "ok";

      console.log(`  Lead:   ${compact(m.body)}`);
      console.log(`  Intent: ${finalIntent}${finalIntent !== classification.intent ? ` (coagido de ${classification.intent})` : ""}`);
      if (actual) console.log(`  Antes:  ${actual.author} · ${compact(actual.body)}`);
      else console.log("  Antes:  sem resposta gravada antes da próxima mensagem do lead");
      console.log(`  Agora:  ${compact(shadow)}`);
      console.log(`  Check:  ${flags}`);
    }
  }

  console.log("\nResumo");
  console.log(`turnos avaliados: ${turns}`);
  console.log(`starter genérico: ${genericStarter}`);
  console.log(`pergunta possivelmente ignorada: ${ignoredQuestion}`);
  console.log(`repetição provável: ${repeated}`);
  console.log(`sem resposta baseline gravada: ${noActualReply}`);
  console.log("observação: replay shadow usa classifier/composer atuais; não envia WhatsApp e não executa writes do orchestrator.\n");

  process.exit(genericStarter + ignoredQuestion + repeated === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
