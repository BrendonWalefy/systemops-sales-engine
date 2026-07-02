/**
 * Gerador de conversas da clínica demo — produz threads COERENTES na voz REAL da
 * recepcionista (Marina), reusando o mesmo `ResponseComposer` da produção.
 *
 * Híbrido: o roteiro do LEAD é curado (determinístico, coerente), e a resposta do
 * AGENTE é gerada pela IA real a partir do playbook da clínica — então o conteúdo é
 * literalmente output do produto, bom para a demo e para marketing.
 *
 * Modo mock (`DISABLE_REAL_OPENAI=true`): não chama OpenAI; usa respostas-modelo
 * coerentes (não "[MOCK] lixo"), para testes/CI e para seed sem chave.
 */
import { ResponseComposer, type ActionResult } from "@/core/intelligence/ResponseComposer";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type { Message } from "@/domain/entities/conversation";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

// ── Especificação de ação por turno (curada no roteiro) ──────────────────────
export type DemoActionSpec =
  | { kind: "general" }
  | { kind: "price"; treatment?: string }
  | { kind: "slots" }
  | { kind: "confirm"; slotIndex?: number }
  | { kind: "reschedule" }
  | { kind: "urgency" }
  | { kind: "handoff"; reason?: string }
  | { kind: "reengagement"; lastAppointmentLabel?: string }
  | { kind: "acknowledgment" }
  | { kind: "farewell" };

export type DemoTurn = { lead: string; action: DemoActionSpec };

export type DemoClinicContext = {
  clinicName: string;
  specialty: string;
  toneOfVoice: string | null;
  playbook: string | null;
  commercialPolicy: string | null;
  receptionistName?: string;
  timezone: ClinicTimezone;
};

export type DemoGeneratedMessage = { author: "lead" | "agent"; body: string; intent: string };

// ── Slots realistas (rótulos próximos, dias úteis) ───────────────────────────
export function buildDemoSlots(count = 3): FormattedSlot[] {
  const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const TIMES = ["10h30", "15h00", "11h00"];
  const base = new Date();
  base.setDate(base.getDate() + 1);
  const slots: FormattedSlot[] = [];
  let cursor = new Date(base);
  for (let i = 0; i < count; i++) {
    if (cursor.getDay() === 0) cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() === 6) cursor.setDate(cursor.getDate() + 2);
    const label = `${WEEKDAYS[cursor.getDay()]} ${String(cursor.getDate()).padStart(2, "0")}/${MONTHS[cursor.getMonth()]} às ${TIMES[i % TIMES.length]}`;
    const end = new Date(cursor);
    end.setHours(end.getHours() + 1);
    slots.push({ index: i + 1, label, startsAt: cursor.toISOString(), endsAt: end.toISOString() });
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function specToActionResult(
  spec: DemoActionSpec,
  clinicName: string,
  slots: FormattedSlot[],
): ActionResult {
  switch (spec.kind) {
    case "price":
      return { type: "price_inquiry", identifiedTreatment: spec.treatment ?? null };
    case "slots":
      return { type: "slots_found", slots, askedForPreference: false };
    case "confirm":
      return { type: "appointment_confirmed", slot: slots[(spec.slotIndex ?? 1) - 1] ?? slots[0], clinicName };
    case "reschedule":
      return { type: "appointment_rescheduled", newSlots: slots };
    case "urgency":
      return { type: "clinical_urgency" };
    case "handoff":
      return { type: "handoff_requested", handoffReason: spec.reason ?? null };
    case "reengagement":
      return { type: "reengagement", lastAppointmentLabel: spec.lastAppointmentLabel ?? "sua avaliação" };
    case "acknowledgment":
      return { type: "acknowledgment" };
    case "farewell":
      return { type: "farewell" };
    case "general":
    default:
      return { type: "general_question", clinicContext: "Pergunta geral sobre a clínica." };
  }
}

// Intent gravado na mensagem (para o inbox e as métricas ficarem coerentes).
const AGENT_INTENT: Record<DemoActionSpec["kind"], string> = {
  general: "general_question",
  price: "price_inquiry",
  slots: "scheduling",
  confirm: "confirmation",
  reschedule: "scheduling",
  urgency: "clinical_urgency",
  handoff: "needs_human",
  reengagement: "follow_up",
  acknowledgment: "small_talk",
  farewell: "small_talk",
};

// ── Fallback coerente sem OpenAI (modo mock) — nunca "[MOCK] lixo" ────────────
function mockAgentText(spec: DemoActionSpec, ctx: DemoClinicContext, slots: FormattedSlot[]): string {
  const nome = ctx.receptionistName ?? "a assistente";
  switch (spec.kind) {
    case "price":
      return "Ótima escolha! O valor depende de uma avaliação rápida pra montar seu plano com segurança — mas já te adianto que trabalhamos com condições que cabem no seu bolso e parcelamos no cartão. Quer que eu veja os horários de avaliação?";
    case "slots":
      return `Perfeito! Tenho estes horários pra avaliação:\n1. ${slots[0]?.label}\n2. ${slots[1]?.label}\n3. ${slots[2]?.label}\n\nQual fica melhor pra você? É só me dizer o número 😊`;
    case "confirm":
      return `Agendamento confirmado ✅ Te espero na ${ctx.clinicName}! Qualquer coisa antes da consulta, é só me chamar por aqui.`;
    case "reschedule":
      return `Claro, sem problema! Consigo remarcar. Tenho ${slots[0]?.label} ou ${slots[1]?.label} — qual prefere?`;
    case "urgency":
      return "Entendo, sinto muito! Isso precisa de atenção. Já estou acionando a equipe pra te atender com prioridade — em instantes alguém fala com você 🙏";
    case "handoff":
      return "Claro! Já avisei a equipe e alguém da recepção continua com você por aqui em breve 😊";
    case "reengagement":
      return "Oi! Passando pra saber se ainda faz sentido seguirmos com sua avaliação. Abriram novos horários esta semana — quer que eu te envie as opções?";
    case "acknowledgment":
      return "Certo! Fico à disposição, tá? 😊";
    case "farewell":
      return "Foi um prazer falar com você! Qualquer dúvida, é só chamar aqui 💚";
    case "general":
    default:
      return `Claro! Sou ${nome}, da ${ctx.clinicName}. Posso te explicar com calma e, se quiser, já deixo uma avaliação pré-reservada. Como prefere seguir?`;
  }
}

function toHistoryMessage(author: "lead" | "agent", body: string, i: number): Message {
  return {
    id: `demo-${i}`,
    conversationId: "demo-gen",
    author: author === "lead" ? "lead" : "agent",
    body,
    sentAt: new Date(),
    externalId: null,
  };
}

/**
 * Gera a thread completa (lead + agente) para um roteiro curado. A resposta do
 * agente vem do ResponseComposer real (ou do fallback coerente em modo mock).
 */
export async function generateDemoThread(
  ctx: DemoClinicContext,
  turns: DemoTurn[],
): Promise<DemoGeneratedMessage[]> {
  const useMock = process.env.DISABLE_REAL_OPENAI === "true";
  const composer = useMock ? null : new ResponseComposer();
  const slots = buildDemoSlots();
  const history: Message[] = [];
  const out: DemoGeneratedMessage[] = [];
  let i = 0;

  for (const turn of turns) {
    // Turno iniciado pela IA (ex.: follow-up de recuperação) não tem mensagem do lead.
    if (turn.lead.trim()) {
      out.push({ author: "lead", body: turn.lead, intent: "price_inquiry" });
      history.push(toHistoryMessage("lead", turn.lead, i++));
    }

    const actionResult = specToActionResult(turn.action, ctx.clinicName, slots);
    let text: string;
    if (composer) {
      const composed = await composer.compose({
        actionResult,
        conversationHistory: history,
        clinic: {
          name: ctx.clinicName,
          specialty: ctx.specialty,
          toneOfVoice: ctx.toneOfVoice,
          playbook: ctx.playbook,
          commercialPolicy: ctx.commercialPolicy,
          receptionistName: ctx.receptionistName,
        },
        leadName: null,
        timezone: ctx.timezone,
        isFirstMessage: i === 1,
      });
      text = composed.text?.trim() || mockAgentText(turn.action, ctx, slots);
    } else {
      text = mockAgentText(turn.action, ctx, slots);
    }

    out.push({ author: "agent", body: text, intent: AGENT_INTENT[turn.action.kind] });
    history.push(toHistoryMessage("agent", text, i++));
  }

  return out;
}
