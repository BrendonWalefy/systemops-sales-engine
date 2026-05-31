import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";
import type { Message } from "@/domain/entities/conversation";
import type { IntentClassification } from "@/core/intelligence/IntentClassifier";

const CLINIC_ID = process.env.PILOT_CLINIC_ID!;
const QA_CALENDAR_ID = process.env.QA_GOOGLE_CALENDAR_ID;
const SIMULATE_API_KEY = process.env.SIMULATE_API_KEY;

const TONE_MAP: Record<string, string> = {
  acolhedor: "Acolhedor e empático",
  tecnico: "Técnico e informativo",
  persuasivo: "Persuasivo e orientado a resultados",
  luxo: "Premium e exclusivo",
};

type FormattedSlot = { index: number; label: string; startsAt: string; endsAt: string };

type SimulateBody = {
  message: string;
  history: { role: "user" | "assistant"; text: string; intent?: string }[];
  playbook: {
    specialty: string;
    procedureDescription: string;
    toneOfVoice: string;
    differentials: string[];
    commercialPolicy: string;
    objections?: { objection: string; response: string }[];
    greetingMessage: string;
  };
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
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
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

function buildPlaybookText(p: SimulateBody["playbook"]): string | null {
  const parts: string[] = [];
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

function buildClinicContext(p: SimulateBody["playbook"]): string {
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

// ── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Autenticação: aceita chave de API (para omniQA) ou sessão de browser (para o admin)
  if (SIMULATE_API_KEY) {
    const key = req.headers.get("x-simulate-key");
    if (key !== SIMULATE_API_KEY) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const body: SimulateBody = await req.json();
    const { message, history, playbook } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const clinic = await db
      .select({
        name: clinics.name,
        timezone: clinics.timezone,
        businessHours: clinics.businessHours,
        defaultAppointmentDurationMinutes: clinics.defaultAppointmentDurationMinutes,
      })
      .from(clinics)
      .where(eq(clinics.id, CLINIC_ID))
      .limit(1)
      .then((r) => r[0]);

    const timezone = new ClinicTimezone(clinic?.timezone ?? "America/Sao_Paulo");
    const clinicName = clinic?.name ?? "Clínica";
    const businessHours = clinic?.businessHours ?? null;
    const durationMinutes = clinic?.defaultAppointmentDurationMinutes ?? 60;
    const isFirst = history.length === 0;

    // ── Pré-verificações sem LLM — espelho do ConversationOrchestrator ─────

    if (isFirst && playbook.greetingMessage.trim()) {
      return NextResponse.json({ text: playbook.greetingMessage.trim(), intent: "greeting" });
    }

    if (!isFirst && isResetCommand(message)) {
      const salutation = getDayGreeting(timezone);
      const text = playbook.greetingMessage.trim()
        ? `${salutation}! ${playbook.greetingMessage.trim()}`
        : `${salutation}! Como posso ajudá-lo?`;
      return NextResponse.json({ text, intent: "greeting" });
    }

    // Detecção de oferta de slots pendente via intent do histórico (espelho da state machine)
    const hasPendingSlotOffer = history.some(
      (h) => h.role === "assistant" && h.intent === "slots_found",
    );

    if (!isFirst && isMenuRerequest(message)) {
      const text = playbook.greetingMessage.trim() || "Como posso ajudá-lo?";
      return NextResponse.json({ text, intent: "greeting" });
    }

    if (!isFirst && !hasPendingSlotOffer && isIsolatedGreeting(message)) {
      const salutation = getDayGreeting(timezone);
      const text = playbook.greetingMessage.trim()
        ? `${salutation}! ${playbook.greetingMessage.trim()}`
        : `${salutation}! Como posso ajudá-lo?`;
      return NextResponse.json({ text, intent: "greeting" });
    }

    // ── Estágio 1: classificação de intent via LLM ────────────────────────

    const conversationHistory: Message[] = history.map((h, i) => ({
      id: `sim-${i}`,
      conversationId: "sandbox",
      author: h.role === "user" ? "lead" : "agent",
      body: h.text,
      sentAt: new Date(),
      externalId: null,
    }));

    const classifier = new IntentClassifier();
    const classification = await classifier.classify(
      message,
      conversationHistory,
      hasPendingSlotOffer,
    );

    // greeting via LLM → retorna menu (igual ao case "greeting" do Orchestrator)
    if (classification.intent === "greeting") {
      const salutation = getDayGreeting(timezone);
      const text = playbook.greetingMessage.trim()
        ? `${salutation}! ${playbook.greetingMessage.trim()}`
        : `${salutation}! Como posso ajudá-lo?`;
      return NextResponse.json({ text, intent: "greeting" });
    }

    // ── Slots: busca real (QA Calendar) ou simulada ───────────────────────

    const slots = await fetchSlots(timezone, businessHours, durationMinutes);

    // ── Estágio 2: composição de resposta via LLM ─────────────────────────

    const clinicContext = buildClinicContext(playbook);
    const actionResult = intentToActionResult(classification, clinicContext, clinicName, slots);

    const composer = new ResponseComposer();
    const result = await composer.compose({
      actionResult,
      conversationHistory,
      clinic: {
        name: clinicName,
        specialty: playbook.specialty || "Odontologia",
        toneOfVoice: TONE_MAP[playbook.toneOfVoice] ?? playbook.toneOfVoice,
        playbook: buildPlaybookText(playbook),
        commercialPolicy: playbook.commercialPolicy || null,
      },
      leadName: null,
      timezone,
      isFirstMessage: isFirst,
    });

    return NextResponse.json({ text: result.text, intent: classification.intent });
  } catch (err) {
    console.error("[playbook/simulate]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
