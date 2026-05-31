import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { ActionResult } from "@/core/intelligence/ResponseComposer";
import type { Message } from "@/domain/entities/conversation";
import type { IntentClassification } from "@/core/intelligence/IntentClassifier";

const CLINIC_ID = process.env.PILOT_CLINIC_ID!;

const TONE_MAP: Record<string, string> = {
  acolhedor: "Acolhedor e empático",
  tecnico: "Técnico e informativo",
  persuasivo: "Persuasivo e orientado a resultados",
  luxo: "Premium e exclusivo",
};

type SimulateBody = {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
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

// Gera slots simulados realistas a partir da data atual
function fakeSlots(count = 3) {
  const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const TIMES = ["09h00", "10h30", "14h00", "15h30", "16h00"];

  const slots = [];
  const base = new Date();
  base.setDate(base.getDate() + 1); // começa amanhã

  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    // pula domingo
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    const label = `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${MONTHS[d.getMonth()]} às ${TIMES[i % TIMES.length]}`;
    const end = new Date(d);
    end.setHours(end.getHours() + 1);
    slots.push({ index: i + 1, label, startsAt: d.toISOString(), endsAt: end.toISOString() });
  }
  return slots;
}

function intentToActionResult(
  classification: IntentClassification,
  clinicContext: string,
  clinicName: string,
): ActionResult {
  const { intent } = classification;

  switch (intent) {
    case "greeting":
      return { type: "greeting" };

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
      return {
        type: "slots_found",
        slots: fakeSlots(3),
        askedForPreference: false,
      };

    case "confirm_slot": {
      const slots = fakeSlots(3);
      const chosen = slots[(classification.slotPreference.slotChoice ?? 1) - 1] ?? slots[0];
      return { type: "appointment_confirmed", slot: chosen, clinicName };
    }

    case "cancel_appointment":
      return { type: "appointment_cancelled", count: 1 };

    case "reschedule_appointment":
      return { type: "appointment_rescheduled", newSlots: fakeSlots(3) };

    case "list_appointments": {
      const slots = fakeSlots(2);
      return {
        type: "appointments_listed",
        appointments: slots.map((s) => ({ label: s.label, status: "scheduled" })),
      };
    }

    default:
      return { type: "general_question", clinicContext };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SimulateBody = await req.json();
    const { message, history, playbook } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const clinic = await db
      .select({ name: clinics.name, timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.id, CLINIC_ID))
      .limit(1)
      .then((r) => r[0]);

    const isFirst = history.length === 0;

    // Saudação configurada retorna diretamente sem chamar LLM
    if (isFirst && playbook.greetingMessage.trim()) {
      return NextResponse.json({ text: playbook.greetingMessage.trim(), intent: "greeting" });
    }

    const conversationHistory: Message[] = history.map((h, i) => ({
      id: `sim-${i}`,
      conversationId: "sandbox",
      author: h.role === "user" ? "lead" : "agent",
      body: h.text,
      sentAt: new Date(),
      externalId: null,
    }));

    // Detecta se há oferta de horários pendente no histórico
    const hasPendingSlotOffer = history.some(
      (h) => h.role === "assistant" && /1\.|2\.|3\./.test(h.text),
    );

    const classifier = new IntentClassifier();
    const classification = await classifier.classify(
      message,
      conversationHistory,
      hasPendingSlotOffer,
    );

    const clinicContext = buildClinicContext(playbook);
    const clinicName = clinic?.name ?? "Clínica";

    const actionResult = intentToActionResult(classification, clinicContext, clinicName);

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
      timezone: new ClinicTimezone(clinic?.timezone ?? "America/Sao_Paulo"),
      isFirstMessage: isFirst,
    });

    return NextResponse.json({ text: result.text, intent: classification.intent });
  } catch (err) {
    console.error("[playbook/simulate]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
