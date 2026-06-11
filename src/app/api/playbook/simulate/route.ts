import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone, getTimeGreeting } from "@/core/scheduling/ClinicTimezone";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import type { ActionResult, ComposedResponse } from "@/core/intelligence/ResponseComposer";
import type { Message } from "@/domain/entities/conversation";
import type { IntentClassification, IntentType } from "@/core/intelligence/IntentClassifier";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import {
  CONCIERGE_MENU_ITEMS,
  DEFAULT_CONVERSATION_EXPERIENCE,
  DEFAULT_MENU_ITEMS,
} from "@/domain/entities/clinic";
import type { ConversationExperience, MenuItem } from "@/domain/entities/clinic";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";

const QA_CALENDAR_ID = process.env.QA_GOOGLE_CALENDAR_ID;
const SIMULATE_API_KEY = process.env.SIMULATE_API_KEY;

const TONE_MAP: Record<string, string> = {
  acolhedor: "Acolhedor e empático",
  tecnico: "Técnico e informativo",
  persuasivo: "Persuasivo e orientado a resultados",
  luxo: "Premium e exclusivo",
};

type FormattedSlot = { index: number; label: string; startsAt: string; endsAt: string };

type PlaybookInput = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  toneOfVoiceRaw?: string; // bypassa TONE_MAP — usado no modo produção
  differentials: string[];
  commercialPolicy: string;
  objections?: { objection: string; response: string }[];
  greetingMessage: string;
  conversationExperience?: ConversationExperience;
  notes?: string | null;
  mediaLibrary?: { id: string; title: string; url: string; type: "video" | "image" }[];
};

type SimulateBody = {
  message: string;
  history: { role: "user" | "assistant"; text: string; intent?: string }[];
  // Modo 1a: clinicId + source:"draft"  → playbook_versions ativo (padrão)
  // Modo 1b: clinicId + source:"production" → versão ativa (espelho da produção)
  clinicId?: string;
  source?: "production" | "draft";
  // Modo 2: playbook inline (editor de rascunho)
  playbook?: PlaybookInput;
};

// ── Helpers espelhando ConversationOrchestrator ──────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function isMenuRerequest(msg: string): boolean {
  const n = norm(msg);
  return (
    n === "menu" ||
    n.includes("tem menu") ||
    n.includes("ver menu") ||
    n.includes("mostrar menu") ||
    n.includes("qual o menu") ||
    n.includes("quero ver o menu") ||
    n.includes("me manda o menu") ||
    n.includes("voltar ao menu") ||
    n.includes("volta ao menu") ||
    n.includes("voltar pro menu") ||
    n.includes("volta pro menu") ||
    n.includes("menu anterior") ||
    n.includes("menu principal")
  );
}

function isIsolatedGreeting(msg: string): boolean {
  const n = norm(msg);
  const patterns = [
    "oi", "ola", "bom dia", "boa tarde", "boa noite",
    "hey", "e ai", "e la", "oi tudo bem", "ola tudo bem",
    "tudo bem", "tudo bom", "como vai", "oi boa tarde",
    "oi bom dia", "oi boa noite",
  ];
  return patterns.some((p) => n === p || n === p + "!" || n === p + "." || n === p + "?");
}

function isResetCommand(msg: string): boolean {
  const n = norm(msg);
  return n === "/reset" || n === "reset" || n === "resetar" || n === "/resetar";
}

function getDayGreeting(timezone: ClinicTimezone): string {
  const { hour } = timezone.toLocalParts(new Date());
  return getTimeGreeting(hour);
}

function defaultMenuItemsForExperience(experience: ConversationExperience): MenuItem[] {
  return experience === "concierge" ? CONCIERGE_MENU_ITEMS : DEFAULT_MENU_ITEMS;
}

function stripGreetingPrefix(text: string): string {
  const stripped = text.replace(/^(?:olá|ola|oi|ei|e\s+aí|e\s+ai|hey)[!.,]?\s+/i, "");
  if (stripped === text) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function buildConciergeStarter(
  timezone: ClinicTimezone,
  clinicName: string,
  greetingMessage?: string | null,
): string {
  const salutation = getDayGreeting(timezone);
  const receptionistName = inferReceptionistNameFromGreeting(greetingMessage);
  const intro = receptionistName
    ? `Sou a ${receptionistName}, assistente virtual da ${clinicName}.`
    : `Sou a assistente virtual da ${clinicName}.`;
  return `${salutation}. Tudo bem?\n\n${intro} Me conta o que você gostaria de ver hoje: avaliação, lentes, valores ou algum tratamento específico?`;
}

// ── Slots: reais (QA Calendar) ou simulados ──────────────────────────────────

async function fetchSlots(
  timezone: ClinicTimezone,
  businessHours: string | null,
  durationMinutes: number,
  count = 3,
): Promise<FormattedSlot[]> {
  if (QA_CALENDAR_ID) {
    try {
      const gateway = new GoogleCalendarGateway(QA_CALENDAR_ID, timezone, businessHours, 0);
      const from = new Date();
      const to = new Date(from);
      to.setDate(to.getDate() + 14);

      const slots = await gateway.listAvailableSlots({
        clinicId: "qa",
        from,
        to,
        slotDurationMinutes: durationMinutes,
      });

      if (slots.length > 0) {
        return slots.slice(0, count).map((s, i) => ({
          index: i + 1,
          label: timezone.formatForHuman(s.startsAt),
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
        }));
      }
    } catch (err) {
      console.warn("[simulate] QA Calendar falhou, usando slots simulados:", err);
    }
  }

  // Fallback: slots simulados realistas
  const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const TIMES = ["09h00", "10h30", "14h00", "15h30", "16h00"];
  const base = new Date();
  base.setDate(base.getDate() + 1);

  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    const label = `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${MONTHS[d.getMonth()]} às ${TIMES[i % TIMES.length]}`;
    const end = new Date(d);
    end.setHours(end.getHours() + 1);
    return { index: i + 1, label, startsAt: d.toISOString(), endsAt: end.toISOString() };
  });
}

// ── Helpers de conteúdo ──────────────────────────────────────────────────────

function buildPlaybookText(p: PlaybookInput): string | null {
  const parts: string[] = [];
  if (p.notes?.trim()) parts.push(p.notes.trim());
  if (p.specialty) parts.push(`ESPECIALIDADE: ${p.specialty}`);
  if (p.procedureDescription) parts.push(`\nSOBRE O PROCEDIMENTO:\n${p.procedureDescription}`);
  const diffs = p.differentials.filter((d) => d.trim());
  if (diffs.length > 0) parts.push(`\nDIFERENCIAIS DA CLÍNICA:\n${diffs.map((d) => `- ${d}`).join("\n")}`);
  const objections = p.objections?.filter((o) => o.objection.trim() || o.response.trim()) ?? [];
  if (objections.length > 0) {
    const objectionText = objections
      .map((o) => [`Objeção: ${o.objection}`, o.response.trim() ? `Resposta: ${o.response}` : null].filter(Boolean).join("\n"))
      .join("\n\n");
    parts.push(`\nOBJEÇÕES E RESPOSTAS:\n${objectionText}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function buildClinicContext(p: PlaybookInput): string {
  return [
    p.specialty && `Especialidade: ${p.specialty}`,
    p.procedureDescription && `Sobre: ${p.procedureDescription}`,
  ]
    .filter(Boolean)
    .join("\n") || "Clínica odontológica";
}

function intentToActionResult(
  classification: IntentClassification,
  clinicContext: string,
  clinicName: string,
  slots: FormattedSlot[],
): ActionResult {
  const { intent } = classification;

  switch (intent) {
    case "acknowledgment":
      return { type: "acknowledgment" };

    case "farewell":
      return { type: "farewell" };

    case "price_inquiry":
      return { type: "price_inquiry" };

    case "clinical_urgency":
      return { type: "clinical_urgency" };

    case "needs_human":
      return { type: "handoff_requested", handoffReason: classification.handoffReason ?? null };

    case "general_question":
      return { type: "general_question", clinicContext };

    case "unclear":
      return {
        type: "clarification_needed",
        question: classification.clarificationQuestion ?? "Pode me contar um pouco mais sobre o que você precisa?",
      };

    case "book_appointment":
    case "check_availability":
    case "reject_slots":
      return { type: "slots_found", slots, askedForPreference: false };

    case "confirm_slot": {
      const chosen = slots[(classification.slotPreference.slotChoice ?? 1) - 1] ?? slots[0];
      return { type: "appointment_confirmed", slot: chosen, clinicName };
    }

    case "cancel_appointment":
      return { type: "appointment_cancelled", count: 1 };

    case "reschedule_appointment":
      return { type: "appointment_rescheduled", newSlots: slots };

    case "list_appointments":
      return {
        type: "appointments_listed",
        appointments: slots.slice(0, 2).map((s) => ({ label: s.label, status: "scheduled" as const })),
      };

    default:
      return { type: "general_question", clinicContext };
  }
}

// ── Mock mode (E2E_MODE=true ou DISABLE_REAL_OPENAI=true) ───────────────────

function makeIntent(
  intent: IntentType,
  extra: Partial<IntentClassification> = {},
): IntentClassification {
  return {
    intent,
    slotPreference: {
      preferredDate: null,
      preferredPeriod: null,
      preferredTime: null,
      slotChoice: extra.slotPreference?.slotChoice ?? null,
      identifiedTreatment: null,
    },
    confidence: 1,
    shouldAskClarification: false,
    clarificationQuestion: null,
    handoffReason: null,
    ...extra,
  };
}

function mockClassify(message: string, hasPendingSlotOffer: boolean): IntentClassification {
  const m = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  if (hasPendingSlotOffer && /^[123]$/.test(m)) {
    return makeIntent("confirm_slot", { slotPreference: { preferredDate: null, preferredPeriod: null, preferredTime: null, slotChoice: Number(m), identifiedTreatment: null } });
  }
  if (/dor|urgente|urgencia|sangrament|emergencia/.test(m)) return makeIntent("clinical_urgency");
  if (/falar com|dentista|humano|especialista|ligar/.test(m)) return makeIntent("needs_human");
  if (/agendar|marcar|quero horario|quero.*(consulta|agenda)/.test(m)) return makeIntent("book_appointment");
  if (/quanto|preco|valor|custo|caro|plano|parcel/.test(m)) return makeIntent("price_inquiry");
  if (/tchau|ate mais|ate logo|obrigado tchau/.test(m)) return makeIntent("farewell");
  if (/^(ok|blz|entendi|certo|combinado)[!.]?$/.test(m)) return makeIntent("acknowledgment");
  if (/cancelar|desmarcar/.test(m)) return makeIntent("cancel_appointment");
  if (/remarcar|reagendar|mudar.{0,5}horario|trocar.{0,5}horario/.test(m)) return makeIntent("reschedule_appointment");
  if (/horario|disponib|vaga/.test(m)) return makeIntent("check_availability");
  if (/meus agendamentos|minhas consultas|quando e minha/.test(m)) return makeIntent("list_appointments");

  return makeIntent("general_question");
}

const MOCK_TEXTS: Partial<Record<ActionResult["type"], string>> = {
  slots_found: "[MOCK] Tenho estes horários disponíveis:\n1. Seg 02/Jun às 09h00\n2. Ter 03/Jun às 10h30\n3. Qua 04/Jun às 14h00\n\nQual prefere? Responda com o número.",
  appointment_confirmed: "[MOCK] Agendamento confirmado! Nossa equipe estará esperando por você.",
  appointment_cancelled: "[MOCK] Agendamento cancelado com sucesso.",
  appointment_rescheduled: "[MOCK] Claro! Vou remarcar. Aqui estão novos horários disponíveis:\n1. Qui 05/Jun às 09h00\n2. Sex 06/Jun às 14h00\n3. Seg 09/Jun às 10h30\n\nQual prefere? Responda com o número.",
  appointments_listed: "[MOCK] Você tem consulta agendada para Seg 02/Jun às 09h00.",
  price_inquiry: "[MOCK] A avaliação inicial é gratuita. Os valores variam conforme o caso e podem ser parcelados em até 12x.",
  clinical_urgency: "[MOCK] Entendo que é urgente. Vou acionar a equipe imediatamente — alguém entrará em contato.",
  handoff_requested: "[MOCK] Claro! Já avisei a equipe e alguém irá responder em breve.",
  farewell: "[MOCK] Foi um prazer! Qualquer dúvida, é só chamar.",
  acknowledgment: "[MOCK] Certo! Posso ajudar com mais alguma coisa?",
  clarification_needed: "[MOCK] Pode me contar um pouco mais sobre o que você precisa?",
  general_question: "[MOCK] Vou te ajudar com essa dúvida sobre nossa clínica.",
};

function mockCompose(actionResult: ActionResult): ComposedResponse {
  let text = MOCK_TEXTS[actionResult.type] ?? "[MOCK] Estou aqui para ajudar.";

  if (actionResult.type === "general_question" && "clinicContext" in actionResult) {
    const ctx = (actionResult as { type: "general_question"; clinicContext: string }).clinicContext;
    if (/procedimentos|lista|bullet|selecionou.*procediment/i.test(ctx)) {
      text = "[MOCK] Realizamos os seguintes procedimentos:\n• Avaliação gratuita\n• Lentes de contato dental\n• Clareamento dental\n• Implantes dentários\n• Ortodontia\n\nCada caso é avaliado individualmente na consulta inicial.";
    } else if (/localiz|endere[çc]o|selecionou.*localiz/i.test(ctx)) {
      text = "[MOCK] Para informações sobre nossa localização e horários de atendimento, nossa equipe entrará em contato em breve.";
    }
  }

  return { parts: [{ type: "text" as const, content: text }], text, mediaIds: [], model: "mock", promptVersion: "mock-v1", inputTokens: 0, outputTokens: 0 };
}

// ── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────────
  // Aceita: (1) session cookie válido (sandbox interno), (2) x-simulate-key (integração externa)
  const sessionToken = req.cookies.get(COOKIE_NAME)?.value;
  const hasValidSession = sessionToken ? !!(await verifyToken(sessionToken)) : false;
  const hasValidApiKey = !!SIMULATE_API_KEY && req.headers.get("x-simulate-key") === SIMULATE_API_KEY;
  const allowUnauthenticated = process.env.SIMULATE_ALLOW_UNAUTHENTICATED === "true";

  if (!allowUnauthenticated && !hasValidSession && !hasValidApiKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const isE2EMode = process.env.DISABLE_REAL_OPENAI === "true" || process.env.E2E_MODE === "true";

  try {
    const body: SimulateBody = await req.json();
    const { message, history } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    // ── Contrato: intent obrigatório em mensagens de assistant ────────────
    const missingIntent = history.filter((h) => h.role === "assistant" && !h.intent);
    if (missingIntent.length > 0) {
      return NextResponse.json({ error: "intent required in assistant history messages" }, { status: 400 });
    }

    // ── Resolução do playbook: Modo 1a (draft), 1b (production) ou 2 (inline) ──
    let playbook: PlaybookInput;

    if (body.clinicId && body.source === "production") {
      // Modo 1b — espelho REAL da produção: lê a versão ativa via o mesmo
      // resolver que o runtime usa. Antes lia clinics.* e divergia da produção.
      const [editorial, clinicRow] = await Promise.all([
        resolveActiveEditorialConfig(body.clinicId),
        db
          .select({ specialty: clinics.specialty, greetingMessage: clinics.greetingMessage })
          .from(clinics)
          .where(eq(clinics.id, body.clinicId))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      // playbookText já é compilado por composePlaybookText e inclui notes +
      // differentials + objections + procedures. Passá-lo como `notes` faz
      // buildPlaybookText emiti-lo sem o label "SOBRE O PROCEDIMENTO:" —
      // o LLM lê as regras de comportamento como orientação, não como descrição.
      playbook = {
        specialty: editorial?.specialty ?? clinicRow?.specialty ?? "Odontologia",
        notes: editorial?.playbookText ?? undefined,
        procedureDescription: "", // vazio: playbookText já compilou tudo
        toneOfVoice: "acolhedor", // ignorado — toneOfVoiceRaw tem prioridade
        toneOfVoiceRaw: editorial?.toneOfVoice ?? undefined,
        differentials: [],
        commercialPolicy: editorial?.commercialPolicy ?? "",
        objections: [],
        greetingMessage: clinicRow?.greetingMessage ?? "",
        mediaLibrary: (editorial?.mediaLibrary ?? []) as { id: string; title: string; url: string; type: "video" | "image" }[],
      };
    } else if (body.clinicId) {
      // Modo 1a — lê do playbook_versions ativo (rascunho publicado)
      const [activeVersion, clinicRow] = await Promise.all([
        db
          .select()
          .from(playbookVersions)
          .where(and(eq(playbookVersions.clinicId, body.clinicId), eq(playbookVersions.status, "active")))
          .orderBy(desc(playbookVersions.createdAt))
          .limit(1)
          .then((r) => r[0] ?? null),
        db
          .select({ greetingMessage: clinics.greetingMessage })
          .from(clinics)
          .where(eq(clinics.id, body.clinicId))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      if (!activeVersion) {
        return NextResponse.json({ error: "no active playbook found for this clinic" }, { status: 404 });
      }

      playbook = {
        specialty: activeVersion.specialty ?? "",
        procedureDescription: activeVersion.procedureDescription ?? "",
        toneOfVoice: activeVersion.toneOfVoice ?? "acolhedor",
        differentials: (activeVersion.differentials as string[] | null) ?? [],
        commercialPolicy: activeVersion.commercialPolicy ?? "",
        objections: (activeVersion.objections as { objection: string; response: string }[] | null) ?? [],
        greetingMessage: clinicRow?.greetingMessage ?? "",
        notes: activeVersion.notes ?? null,
        mediaLibrary: (activeVersion.mediaLibrary as { id: string; title: string; url: string; type: "video" | "image" }[] | null) ?? [],
      };
    } else if (body.playbook) {
      playbook = body.playbook;
    } else {
      return NextResponse.json({ error: "clinicId or playbook required" }, { status: 400 });
    }

    // ── Dados da clínica (timezone, nome, businessHours, menuItems, address) ──
    const clinicLookupId = body.clinicId ?? (await getSessionClinicId()) ?? "";
    const clinic = await db
      .select({
        name: clinics.name,
        timezone: clinics.timezone,
        businessHours: clinics.businessHours,
        defaultAppointmentDurationMinutes: clinics.defaultAppointmentDurationMinutes,
        conversationExperience: clinics.conversationExperience,
        menuItems: clinics.menuItems,
        address: clinics.address,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicLookupId))
      .limit(1)
      .then((r) => r[0]);

    const timezone = new ClinicTimezone(clinic?.timezone ?? "America/Sao_Paulo");
    const clinicName = clinic?.name ?? "Clínica";
    const businessHours = clinic?.businessHours ?? null;
    const durationMinutes = clinic?.defaultAppointmentDurationMinutes ?? 60;
    const clinicAddress = clinic?.address ?? null;
    const conversationExperience: ConversationExperience =
      body.playbook?.conversationExperience ??
      clinic?.conversationExperience ??
      DEFAULT_CONVERSATION_EXPERIENCE;
    const menuItems: MenuItem[] = (clinic?.menuItems as MenuItem[] | null) ?? defaultMenuItemsForExperience(conversationExperience);
    const menuText = menuItems.filter((i) => i.enabled).map((i) => `${i.number}. ${i.label}`).join("\n");
    const isFirst = history.length === 0;

    function buildGreeting(intro: string): string {
      return intro ? `${intro}\n\n${menuText}` : menuText;
    }

    // Espelho de resolveMenuSelection do ConversationOrchestrator
    function resolveMenuSelection(msg: string): { intent: string; subtype?: "procedures" | "location" } | null {
      const n = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const byNumber = menuItems.find((i) => i.enabled && n === String(i.number));
      if (byNumber) {
        if (byNumber.intent === "procedures") return { intent: "general_question", subtype: "procedures" };
        if (byNumber.intent === "location")   return { intent: "general_question", subtype: "location" };
        return { intent: byNumber.intent };
      }
      if (n.includes("procedimento") || n.includes("tratamento") || n.includes("servico"))
        return { intent: "general_question", subtype: "procedures" };
      if (n.includes("agendar") || n.includes("horario") || n.includes("marcar") || n.includes("avaliacao"))
        return { intent: "book_appointment" };
      if (n.includes("pagamento") || n.includes("valor") || n.includes("preco") || n.includes("parcela") || n.includes("forma"))
        return { intent: "price_inquiry" };
      if (n.includes("localizacao") || n.includes("endereco") || n.includes("onde") || n.includes("fica"))
        return { intent: "general_question", subtype: "location" };
      if (n.includes("especialista") || n.includes("humano") || n.includes("atendente"))
        return { intent: "needs_human" };
      return null;
    }

    // ── Pré-verificações sem LLM — espelho do ConversationOrchestrator ─────

    // Urgência e handoff explícito no primeiro contato bypassam o menu (espelho do Orchestrator)
    const firstContactBypassIntents = /dor|urgente|urgencia|sangrament|emergencia|falar com|dentista|humano|especialista|atendente/;
    const isFirstContactBypass = isFirst && firstContactBypassIntents.test(norm(message));

    if (
      isFirst &&
      conversationExperience === "menu_first" &&
      !isFirstContactBypass &&
      isIsolatedGreeting(message) &&
      playbook.greetingMessage.trim()
    ) {
      const salutation = getDayGreeting(timezone);
      const cleanedGreeting = stripGreetingPrefix(playbook.greetingMessage.trim());
      return NextResponse.json({ text: buildGreeting(`${salutation}! ${cleanedGreeting}`), intent: "greeting" });
    }

    if (!isFirst && isResetCommand(message)) {
      if (conversationExperience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const intro = playbook.greetingMessage.trim()
          ? `${salutation}! ${stripGreetingPrefix(playbook.greetingMessage.trim())}`
          : `${salutation}! Como posso ajudá-lo?`;
        return NextResponse.json({ text: buildGreeting(intro), intent: "greeting" });
      }
      return NextResponse.json({ text: buildConciergeStarter(timezone, clinicName, playbook.greetingMessage), intent: "greeting" });
    }

    // Detecção de oferta de slots pendente via intent do histórico (espelho da state machine)
    const hasPendingSlotOffer = history.some(
      (h) => h.role === "assistant" && h.intent === "slots_found",
    );

    // isMenuActive: última mensagem da IA foi um greeting (menu foi exibido)
    const lastAssistant = [...history].reverse().find((h) => h.role === "assistant");
    const isMenuActive = !hasPendingSlotOffer && lastAssistant?.intent === "greeting";

    if (!isFirst && isMenuRerequest(message)) {
      const intro = playbook.greetingMessage.trim() || "Como posso ajudá-lo?";
      return NextResponse.json({ text: buildGreeting(intro), intent: "greeting" });
    }

    if (!isFirst && !hasPendingSlotOffer && isIsolatedGreeting(message)) {
      if (conversationExperience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const intro = playbook.greetingMessage.trim()
          ? `${salutation}! ${stripGreetingPrefix(playbook.greetingMessage.trim())}`
          : `${salutation}! Como posso ajudá-lo?`;
        return NextResponse.json({ text: buildGreeting(intro), intent: "greeting" });
      }
      return NextResponse.json({ text: `${getDayGreeting(timezone)}! Estou por aqui.`, intent: "acknowledgment" });
    }

    // ── Resolução de menu (sem LLM) — espelho do Orchestrator ────────────
    const menuResolution = isMenuActive ? resolveMenuSelection(message) : null;

    // ── Estágio 1: classificação de intent via LLM (bypass se menu resolvido) ──

    const conversationHistory: Message[] = history.map((h, i) => ({
      id: `sim-${i}`,
      conversationId: "sandbox",
      author: h.role === "user" ? "lead" : "agent",
      body: h.text,
      sentAt: new Date(),
      externalId: null,
    }));

    const nullSlotPref = { preferredDate: null as null, preferredPeriod: null as null, preferredTime: null as null, slotChoice: null as null, identifiedTreatment: null as null };

    const classification = menuResolution
      ? {
          intent: menuResolution.intent as IntentType,
          slotPreference: nullSlotPref,
          confidence: 1,
          shouldAskClarification: false,
          clarificationQuestion: null as null,
          handoffReason: menuResolution.intent === "needs_human" ? "Lead solicitou falar com um atendente" : null as null,
        }
      : isE2EMode
      ? mockClassify(message, hasPendingSlotOffer)
      : await new IntentClassifier().classify(message, conversationHistory, hasPendingSlotOffer);

    if (
      isFirst &&
      conversationExperience === "concierge" &&
      (classification.intent === "greeting" || classification.intent === "acknowledgment" || classification.intent === "unclear")
    ) {
      return NextResponse.json({ text: buildConciergeStarter(timezone, clinicName, playbook.greetingMessage), intent: "greeting" });
    }

    // greeting via LLM → retorna menu ou starter conforme experiência
    if (classification.intent === "greeting") {
      if (conversationExperience === "menu_first") {
        const salutation = getDayGreeting(timezone);
        const intro = playbook.greetingMessage.trim()
          ? `${salutation}! ${stripGreetingPrefix(playbook.greetingMessage.trim())}`
          : `${salutation}! Como posso ajudá-lo?`;
        return NextResponse.json({ text: buildGreeting(intro), intent: "greeting" });
      }
      return NextResponse.json({ text: buildConciergeStarter(timezone, clinicName, playbook.greetingMessage), intent: "greeting" });
    }

    // ── Slots: busca real (QA Calendar) ou simulada ───────────────────────

    const slots = await fetchSlots(timezone, businessHours, durationMinutes);

    // ── Contexto clínico — resolve subtype de menu (procedimentos/localização) ──
    let clinicContext = buildClinicContext(playbook);
    if (menuResolution?.subtype === "procedures") {
      const desc = playbook.procedureDescription?.trim();
      clinicContext = `Lead selecionou "Procedimentos" no menu.\nFORMATO OBRIGATÓRIO: apresente os procedimentos exatamente como uma lista numerada, um por linha, sem adicionar descrições. Ao final, acrescente uma linha em branco seguida de: "Quer saber mais sobre algum? É só digitar o número. Para voltar ao menu principal, é só digitar *menu*." Sem convite para agendar.\n${desc ?? ""}`;
    } else if (menuResolution?.subtype === "location") {
      const base = `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;
      if (clinicAddress) {
        clinicContext = `${base}\nEndereço: ${clinicAddress}.`;
      } else {
        clinicContext = `${base}\nEndereço: não cadastrado no sistema. Informe que a equipe pode passar o endereço, ou que o lead pode entrar em contato diretamente. NÃO invente endereço.`;
      }
    }

    const actionResult = intentToActionResult(classification, clinicContext, clinicName, slots);

    const result = isE2EMode
      ? mockCompose(actionResult)
      : await new ResponseComposer().compose({
          actionResult,
          conversationHistory,
          clinic: {
            name: clinicName,
            specialty: playbook.specialty || "Odontologia",
            toneOfVoice: playbook.toneOfVoiceRaw ?? TONE_MAP[playbook.toneOfVoice] ?? playbook.toneOfVoice,
            playbook: buildPlaybookText(playbook),
            commercialPolicy: playbook.commercialPolicy || null,
            mediaLibrary: playbook.mediaLibrary ?? [],
            receptionistName: inferReceptionistNameFromGreeting(playbook.greetingMessage) ?? undefined,
          },
          leadName: null,
          timezone,
          isFirstMessage: isFirst,
          conversationExperience,
        });

    const debugInfo = process.env.E2E_MODE === "true"
      ? {
          playbookBlocksUsed: [
            playbook.specialty ? "specialty" : null,
            playbook.procedureDescription ? "procedureDescription" : null,
            (playbook.differentials?.length ?? 0) > 0 ? "differentials" : null,
            (playbook.objections?.length ?? 0) > 0 ? "objections" : null,
            playbook.commercialPolicy ? "commercialPolicy" : null,
          ].filter(Boolean),
        }
      : undefined;

    const INTENTS_WITH_SLOTS = ["book_appointment", "check_availability", "reject_slots", "confirm_slot", "reschedule_appointment"];

    // Quando o pipeline produziu uma oferta de slots, retornar "slots_found" como intent
    // para que conversas multi-turno detectem hasPendingSlotOffer corretamente via histórico.
    const responseIntent = menuResolution?.subtype === "procedures"
      ? "procedure_list"
      : actionResult.type === "slots_found"
        ? "slots_found"
        : classification.intent;

    return NextResponse.json({
      text: result.text,
      intent: responseIntent,
      ...(INTENTS_WITH_SLOTS.includes(classification.intent) ? { slots } : {}),
      ...(debugInfo ? { debug: debugInfo } : {}),
    });
  } catch (err) {
    console.error("[playbook/simulate]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
