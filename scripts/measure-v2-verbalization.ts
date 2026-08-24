/**
 * Mede a verbalização da V2 contra o modelo real.
 *
 * Não toca banco, canal, agenda ou outbox: monta planos autorizados a partir do
 * schema dental real, chama o verbalizador vivo e aplica o mesmo validador que
 * a produção aplica. O que interessa medir é quanto da prosa do modelo sobrevive
 * ao plano — teste verde não responde essa pergunta.
 *
 * Uso:
 *   npx dotenv -e <caminho>/.env.local -- npx tsx scripts/measure-v2-verbalization.ts [repetições]
 */
import OpenAI from "openai";
import { buildV2AuthorizedResponsePlan } from "../src/conversation-core/authorized-response-plan";
import {
  authorizedStatementsFor,
  authorizedSurfaceFor,
} from "../src/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "../src/conversation-core/composer/deterministic-composer";
import { renderDeterministicResponse } from "../src/conversation-core/composer/deterministic-renderer";
import { validateDraft } from "../src/conversation-core/composer/validator";
import { validateVerbalizedText } from "../src/conversation-core/composer/verbalization-validator";
import type { SpeakerProfile } from "../src/conversation-core/composer/verbalization";
import type { ActionResult } from "../src/conversation-core/decision";
import { DENTAL_OUTCOME_SCHEMA } from "../src/domain-packs/dental/capabilities";
import { createLiveResponseVerbalizer } from "../src/infrastructure/adapters/ai/live-response-verbalizer";

type Results = ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[];

const service = { type: "service", id: "service-1", displayName: "Lentes de resina" };
const packaged = { type: "service", id: "service-3", displayName: "Clareamento 3 sessões" };
const evaluation = { type: "service", id: "service-2", displayName: "Avaliação" };
// Formato real de `ClinicTimezone.formatForHuman`, e não um rótulo idealizado:
// é ele que a verbalização precisa atravessar inteiro.
const slotA = { type: "slot", id: "slot-1", displayName: "Qua 20/08 às 15h30" };
const slotB = { type: "slot", id: "slot-2", displayName: "Qui 21/08 às 9h" };
const appointment = { type: "appointment", id: "appointment-1", displayName: "Qua 20/08 às 15h30" };
const read = { source: "read", reference: "catalog-1" } as const;
const write = { source: "write", reference: "booking-1" } as const;

function option(slot: Readonly<{ type: string; id: string; displayName: string }>) {
  return {
    id: slot.id,
    subject: slot,
    facts: [{
      key: "slot_label" as const,
      value: { kind: "display_text" as const, value: slot.displayName },
      subject: slot,
      evidence: read,
      disclosure: "allowed" as const,
    }],
  };
}

const scenarios: readonly Readonly<{ name: string; results: Results }>[] = Object.freeze([
  {
    name: "abertura",
    results: [{
      type: "reception_answered", semanticClass: "engagement_invited",
      origin: { capabilityId: "dental-reception" }, subject: null, evidence: [], facts: [],
    }],
  },
  {
    name: "preço",
    results: [{
      type: "catalog_answered", semanticClass: "information_authorized",
      origin: { capabilityId: "dental-catalog" }, subject: service, evidence: [read],
      facts: [{
        key: "price_cents", value: { kind: "money", amountInMinor: 400_000, currency: "BRL" },
        subject: service, evidence: read, disclosure: "allowed",
      }],
    }],
  },
  {
    name: "horários",
    results: [{
      type: "slots_found", semanticClass: "options_found",
      origin: { capabilityId: "dental-scheduling" }, subject: service, evidence: [read], facts: [],
      options: [option(slotA), option(slotB)],
    }],
  },
  {
    name: "agendamento confirmado",
    results: [{
      type: "appointment_created", semanticClass: "effect_completed",
      origin: { capabilityId: "dental-scheduling" }, subject: appointment, evidence: [write],
      facts: [{
        key: "appointment_label", value: { kind: "display_text", value: appointment.displayName },
        subject: appointment, evidence: write, disclosure: "allowed",
      }],
    }],
  },
  {
    name: "preço de item com número no nome",
    results: [{
      type: "catalog_answered", semanticClass: "information_authorized",
      origin: { capabilityId: "dental-catalog" }, subject: packaged, evidence: [read],
      facts: [{
        key: "price_cents", value: { kind: "money", amountInMinor: 120_000, currency: "BRL" },
        subject: packaged, evidence: read, disclosure: "allowed",
      }],
    }],
  },
  {
    name: "falha de agenda",
    results: [{
      type: "appointment_create_failed", semanticClass: "effect_failed",
      origin: { capabilityId: "dental-scheduling" }, subject: null, evidence: [write], facts: [],
    }],
  },
  {
    name: "não encontrei o procedimento",
    results: [{
      type: "clarification_required", semanticClass: "clarification_required",
      origin: { capabilityId: "dental-catalog" }, subject: null, evidence: [], facts: [],
    }],
  },
  {
    name: "escolha entre dois procedimentos",
    results: [{
      type: "service_options_offered", semanticClass: "options_found",
      origin: { capabilityId: "dental-catalog" }, subject: null, evidence: [read], facts: [],
      options: [
        {
          id: "t1",
          subject: service,
          facts: [{ key: "service_name", value: { kind: "display_text", value: service.displayName }, subject: service, evidence: read, disclosure: "allowed" as const }],
        },
        {
          id: "t2",
          subject: packaged,
          facts: [{ key: "service_name", value: { kind: "display_text", value: packaged.displayName }, subject: packaged, evidence: read, disclosure: "allowed" as const }],
        },
      ],
    }],
  },
  {
    name: "handoff humano",
    results: [{
      type: "escalation_required", semanticClass: "human_action_required",
      origin: { capabilityId: "dental-escalation" }, subject: null, evidence: [], facts: [],
    }],
  },
  {
    name: "preço + horários",
    results: [
      {
        type: "catalog_answered", semanticClass: "information_authorized",
        origin: { capabilityId: "dental-catalog" }, subject: evaluation, evidence: [read],
        facts: [{
          key: "price_cents", value: { kind: "money", amountInMinor: 0, currency: "BRL" },
          subject: evaluation, evidence: read, disclosure: "allowed",
        }],
      },
      {
        type: "slots_found", semanticClass: "options_found",
        origin: { capabilityId: "dental-scheduling" }, subject: evaluation, evidence: [read], facts: [],
        options: [option(slotA)],
      },
    ],
  },
]);

const speaker: SpeakerProfile = Object.freeze({
  agentName: "Marina",
  organizationName: "SystemOps Dental Lab",
  specialty: "odontologia estética",
  toneOfVoice: "acolhedor, direto e sem formalidade excessiva",
  guidelines: Object.freeze([
    "Responder primeiro, perguntar depois.",
    "No máximo uma pergunta principal por vez.",
    "Nunca inventar preço, condição, disponibilidade, resultado, desconto ou garantia.",
    "Avaliação é sempre gratuita.",
  ]),
});

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente no shell");
  const repetitions = Math.max(1, Number.parseInt(process.argv[2] ?? "1", 10));
  const verbalizer = createLiveResponseVerbalizer(new OpenAI({ apiKey }) as never);
  let accepted = 0;
  let total = 0;
  const rejections = new Map<string, number>();

  for (const scenario of scenarios) {
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, scenario.results);
    const validation = validateDraft(plan, buildDeterministicDraft(plan));
    if (!validation.valid) throw new Error(`${scenario.name}: ${JSON.stringify(validation.violations)}`);
    const authorizedText = renderDeterministicResponse({ draft: validation.draft }).text;
    const surface = authorizedSurfaceFor(validation.draft);
    console.log(`\n### ${scenario.name}`);
    console.log(`autorizado: ${authorizedText}`);
    console.log(`valores: [${surface.values.join(" | ")}] · moeda: ${surface.currencyAllowed} · perguntas: ${surface.maxQuestions}`);

    for (let attempt = 0; attempt < repetitions; attempt += 1) {
      total += 1;
      let text: string;
      try {
        text = await verbalizer.verbalize({
          surface,
          statements: authorizedStatementsFor(validation.draft),
          style: { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" },
          speaker,
        }, { signal: AbortSignal.timeout(20_000) }) as string;
      } catch (error) {
        console.log(`  falhou: ${error instanceof Error ? error.message : "erro"}`);
        rejections.set("provider_error", (rejections.get("provider_error") ?? 0) + 1);
        continue;
      }
      const checked = validateVerbalizedText({ text, surface });
      if (checked.valid) {
        accepted += 1;
        console.log(`  aceito: ${text}`);
        continue;
      }
      for (const code of checked.violations) {
        rejections.set(code, (rejections.get(code) ?? 0) + 1);
      }
      console.log(`  RECUSADO [${checked.violations.join(", ")}]: ${text}`);
    }
  }

  console.log(`\naceitos ${accepted}/${total} (${Math.round((accepted / total) * 100)}%)`);
  for (const [code, count] of [...rejections].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${count}`);
  }
}

void main();
