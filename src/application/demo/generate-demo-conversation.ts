/**
 * Gerador de conversas da clínica demo — produz threads COERENTES na voz REAL da
 * recepcionista (Marina), rodando o MESMO pipeline da produção:
 *   mensagem do lead → IntentClassifier → ação → ResponseComposer.
 *
 * Como o roteiro do LEAD é curado (progressão natural) e a IA classifica e responde
 * de verdade, a conversa flui como em produção — é "o mais próximo do real possível".
 *
 * Modo mock (`DISABLE_REAL_OPENAI=true`): não chama OpenAI; classifica por regex e usa
 * respostas-modelo coerentes, para testes/CI e para seed sem chave.
 */
import { IntentClassifier, type IntentClassification, type IntentType } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer, type ActionResult } from "@/core/intelligence/ResponseComposer";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type { Message } from "@/domain/entities/conversation";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export type DemoTurn = {
  lead: string;         // mensagem do lead; vazio = turno proativo da IA (reengajamento)
  agent?: string;       // resposta curada da Marina; quando ausente, usa ResponseComposer/mock
  voice?: boolean;      // resposta do agente entregue como ÁUDIO (deliveryFormat "audio")
  media?: "video" | "image"; // anexa um item da biblioteca de mídia à resposta
};

export type DemoClinicContext = {
  clinicName: string;
  specialty: string;
  toneOfVoice: string | null;
  playbook: string | null;
  commercialPolicy: string | null;
  receptionistName?: string;
  timezone: ClinicTimezone;
};

export type DemoGeneratedMessage = {
  author: "lead" | "agent";
  body: string;
  intent: string;
  voice?: boolean;
  media?: "video" | "image";
};

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

// ── intent → ActionResult (espelho compacto do ConversationOrchestrator/simulate) ──
function intentToAction(
  c: IntentClassification,
  clinicName: string,
  slots: FormattedSlot[],
): ActionResult {
  switch (c.intent) {
    case "price_inquiry":
      return { type: "price_inquiry", identifiedTreatment: c.slotPreference.identifiedTreatment ?? null };
    case "clinical_urgency":
      return { type: "clinical_urgency" };
    case "needs_human":
      return { type: "handoff_requested", handoffReason: c.handoffReason ?? null };
    case "book_appointment":
    case "check_availability":
    case "reject_slots":
      return { type: "slots_found", slots, askedForPreference: false };
    case "confirm_slot":
      return { type: "appointment_confirmed", slot: slots[(c.slotPreference.slotChoice ?? 1) - 1] ?? slots[0], clinicName };
    case "reschedule_appointment":
      return { type: "appointment_rescheduled", newSlots: slots };
    case "cancel_appointment":
      return { type: "appointment_cancelled", count: 1 };
    case "list_appointments":
      return { type: "appointments_listed", appointments: slots.slice(0, 2).map((s) => ({ label: s.label, status: "scheduled" })) };
    case "acknowledgment":
      return { type: "acknowledgment" };
    case "farewell":
      return { type: "farewell" };
    case "greeting":
      return { type: "greeting" };
    case "unclear":
      return { type: "clarification_needed", question: c.clarificationQuestion ?? "Pode me contar um pouco mais sobre o que você procura?" };
    case "general_question":
    default:
      return { type: "general_question", clinicContext: "Pergunta geral sobre a clínica — responda com base no playbook, sem inventar preço." };
  }
}

const AGENT_INTENT_BY_ACTION: Partial<Record<ActionResult["type"], string>> = {
  slots_found: "scheduling",
  appointment_confirmed: "confirmation",
  appointment_rescheduled: "scheduling",
  price_inquiry: "price_inquiry",
  clinical_urgency: "clinical_urgency",
  handoff_requested: "needs_human",
  general_question: "general_question",
  acknowledgment: "small_talk",
  farewell: "small_talk",
  reengagement: "follow_up",
};

// ── Mock (sem OpenAI): classificação por regex + respostas coerentes ─────────
function mockClassify(message: string, hasPendingSlotOffer: boolean): IntentClassification {
  const m = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  let intent: IntentType = "general_question";
  let slotChoice: number | null = null;
  if (
    hasPendingSlotOffer &&
    /(primeir|segund|terceir|^[123]\b|primeiro|o 1|a 1|segunda|terca|quarta|quinta|sexta|sabado|domingo|\d{1,2}h)/.test(m)
  ) intent = "confirm_slot";
  else if (/dor|urgente|urgencia|sangrament|emergencia|quebr|trinc|caiu/.test(m)) intent = "clinical_urgency";
  else if (/falar com|atendente|humano|especialista/.test(m)) intent = "needs_human";
  else if (/remarcar|reagendar|mudar.*horario|trocar.*horario/.test(m)) intent = "reschedule_appointment";
  else if (/agendar|marcar|horario|disponib|vaga|avaliacao/.test(m)) intent = "book_appointment";
  else if (/quanto|preco|valor|custo|caro|parcel|investiment/.test(m)) intent = "price_inquiry";
  else if (/vou pensar|te retorno|te falo|deixa eu ver|mais pra frente/.test(m)) intent = "acknowledgment";
  else if (/obrigad|tchau|ate mais|valeu/.test(m)) intent = "farewell";
  if (intent === "confirm_slot") slotChoice = /segund|o 2|a 2/.test(m) ? 2 : /terceir|o 3|a 3/.test(m) ? 3 : 1;
  return {
    intent,
    slotPreference: { preferredDate: null, preferredPeriod: null, preferredTime: null, slotChoice, identifiedTreatment: null, ambiguousTreatmentMatches: null },
    confidence: 1,
    shouldAskClarification: false,
    clarificationQuestion: null,
    handoffReason: intent === "needs_human" ? "Lead pediu atendimento humano" : null,
  };
}

function mockCompose(action: ActionResult, ctx: DemoClinicContext, slots: FormattedSlot[]): string {
  switch (action.type) {
    case "price_inquiry":
      return "Ótima escolha! O valor a gente fecha numa avaliação rápida pra montar seu plano com segurança — mas já adianto que parcelamos no cartão e tem opções que cabem no seu bolso. Quer que eu veja os horários de avaliação?";
    case "slots_found":
      return `Perfeito! Tenho estes horários pra avaliação:\n1. ${slots[0]?.label}\n2. ${slots[1]?.label}\n3. ${slots[2]?.label}\n\nQual fica melhor? É só me dizer o número 😊`;
    case "appointment_confirmed":
      return `Agendamento confirmado ✅ Te espero na ${ctx.clinicName}! Se precisar de algo antes, é só me chamar por aqui.`;
    case "appointment_rescheduled":
      return `Claro, sem problema! Consigo remarcar. Tenho ${slots[0]?.label} ou ${slots[1]?.label} — qual prefere?`;
    case "clinical_urgency":
      return "Sinto muito, isso precisa de atenção! Já estou acionando a equipe pra te atender com prioridade — em instantes alguém fala com você 🙏";
    case "handoff_requested":
      return "Claro! Já avisei a equipe e a recepção continua com você por aqui em instantes 😊";
    case "reengagement":
      return "Oi! Passando pra saber se ainda faz sentido seguirmos com sua avaliação — abriram novos horários esta semana. Quer que eu te envie as opções?";
    case "acknowledgment":
      return "Combinado! Fico à disposição quando quiser, tá? 😊";
    case "farewell":
      return "Foi um prazer! Qualquer dúvida, é só chamar aqui 💚";
    case "clarification_needed":
      return "Pode me contar um pouquinho mais pra eu te ajudar certinho? 😊";
    case "general_question":
    default:
      return `Claro! Sou ${ctx.receptionistName ?? "a assistente"} da ${ctx.clinicName}. Te explico com calma e, se quiser, já deixo uma avaliação pré-reservada. Como prefere seguir?`;
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
 * Gera a thread completa rodando o pipeline real (ou mock). Cada mensagem do lead é
 * classificada e respondida de verdade, então a conversa flui como em produção.
 */
export async function generateDemoThread(
  ctx: DemoClinicContext,
  turns: DemoTurn[],
): Promise<DemoGeneratedMessage[]> {
  const useMock = process.env.DISABLE_REAL_OPENAI === "true";
  const classifier = useMock ? null : new IntentClassifier();
  const composer = useMock ? null : new ResponseComposer();
  const slots = buildDemoSlots();
  const history: Message[] = [];
  const out: DemoGeneratedMessage[] = [];
  let hasPendingSlotOffer = false;
  let i = 0;

  for (const turn of turns) {
    const proactive = !turn.lead.trim();
    const curatedAgentReply = turn.agent?.trim() ?? "";
    const hasCuratedAgentReply = curatedAgentReply.length > 0;
    if (!proactive) {
      out.push({ author: "lead", body: turn.lead, intent: "lead" });
      history.push(toHistoryMessage("lead", turn.lead, i++));
    }

    // Turno proativo (reengajamento) não classifica — é iniciativa da IA.
    const action: ActionResult = proactive
      ? { type: "reengagement", lastAppointmentLabel: "sua avaliação" }
      : intentToAction(
          hasCuratedAgentReply
            ? mockClassify(turn.lead, hasPendingSlotOffer)
            : classifier
              ? await classifier.classify(turn.lead, history, hasPendingSlotOffer)
              : mockClassify(turn.lead, hasPendingSlotOffer),
          ctx.clinicName,
          slots,
        );
    hasPendingSlotOffer = action.type === "slots_found";

    let text: string;
    if (hasCuratedAgentReply) {
      text = curatedAgentReply;
    } else if (composer) {
      const composed = await composer.compose({
        actionResult: action,
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
        isFirstMessage: i <= 1,
      });
      text = composed.text?.trim() || mockCompose(action, ctx, slots);
    } else {
      text = mockCompose(action, ctx, slots);
    }

    out.push({
      author: "agent",
      body: text,
      intent: AGENT_INTENT_BY_ACTION[action.type] ?? "general_question",
      voice: turn.voice,
      media: turn.media,
    });
    history.push(toHistoryMessage("agent", text, i++));
  }

  return out;
}
