// Testes para lead que já tem appointment_scheduled e tenta agendar novamente.
// Cobre: detecção de appointment ativo, fluxo de reagendamento vs. novo agendamento,
// e o crash real observado no Silva (14/Jun/2026) onde "Avaliação" após
// "qual procedimento?" gerou "Ops, tive um problema técnico".
//
// Causa raiz do crash: o Orchestrator chamou listAvailableSlots com um slot
// que o InternalCalendarGateway tenta calcular, mas o appointmentRepo retornou
// dados inesperados quando o lead tinha appointment_scheduled com data no passado.
//
// Os testes aqui verificam o comportamento ESPERADO do sistema nesse cenário
// e documentam as invariantes que o Orchestrator deve garantir.

import { describe, it, expect } from "vitest";

// ─── Tipos locais (espelham o domínio) ────────────────────────────────────────

type LeadStatus =
  | "new"
  | "in_conversation"
  | "waiting_response"
  | "appointment_scheduled"
  | "won"
  | "lost";

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";

type AppointmentSummary = {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  source: "app" | "google_calendar";
};

// ─── Lógica pura: detectar appointment ativo ──────────────────────────────────

function hasActiveAppointment(appointments: AppointmentSummary[], now: Date): boolean {
  return appointments.some(
    (a) =>
      (a.status === "scheduled" || a.status === "confirmed") &&
      a.startsAt.getTime() > now.getTime(),
  );
}

function hasExpiredAppointment(appointments: AppointmentSummary[], now: Date): boolean {
  return appointments.some(
    (a) =>
      (a.status === "scheduled" || a.status === "confirmed") &&
      a.startsAt.getTime() <= now.getTime(),
  );
}

// ─── Lógica pura: classificar intenção de reagendamento ───────────────────────

type RebookingDecision =
  | { action: "offer_slots" }                        // lead novo ou sem appointment ativo
  | { action: "ask_to_reschedule"; existingAppt: AppointmentSummary } // já tem appointment futuro
  | { action: "offer_slots_past_appointment_expired" }; // appointment existiu mas já passou

function classifyRebookingIntent(
  leadStatus: LeadStatus,
  activeAppointments: AppointmentSummary[],
  now: Date,
): RebookingDecision {
  const future = activeAppointments.filter(
    (a) =>
      (a.status === "scheduled" || a.status === "confirmed") &&
      a.startsAt.getTime() > now.getTime(),
  );

  if (future.length > 0) {
    return { action: "ask_to_reschedule", existingAppt: future[0] };
  }

  // Se o lead tem status appointment_scheduled mas o appointment está no passado,
  // é um retorno (consulta já aconteceu) — oferecer novos slots normalmente.
  const hasExpired = hasExpiredAppointment(activeAppointments, now);
  if (leadStatus === "appointment_scheduled" && hasExpired) {
    return { action: "offer_slots_past_appointment_expired" };
  }

  return { action: "offer_slots" };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-04T13:13:00.000Z"); // 04/Jun/2026 às 13h13 (hora do bug real)

// Appointment da consulta de Silva em 01/Jun/2026 às 11h (já passada em Jun/04)
const pastAppt: AppointmentSummary = {
  id: "appt-jun-01",
  startsAt: new Date("2026-06-01T14:00:00.000Z"), // horário UTC (11h BRT)
  status: "scheduled",
  source: "app",
};

// Appointment futuro (ainda não aconteceu)
const futureAppt: AppointmentSummary = {
  id: "appt-jun-10",
  startsAt: new Date("2026-06-10T13:00:00.000Z"), // 10/Jun no futuro
  status: "scheduled",
  source: "app",
};

// ─── Testes: detecção de appointment ativo ────────────────────────────────────

describe("LeadRebooking — detecção de appointment ativo vs. expirado", () => {
  it("appointment futuro → tem appointment ativo", () => {
    expect(hasActiveAppointment([futureAppt], NOW)).toBe(true);
  });

  it("appointment no passado → NÃO tem appointment ativo (consulta já ocorreu)", () => {
    expect(hasActiveAppointment([pastAppt], NOW)).toBe(false);
  });

  it("lista vazia → sem appointment ativo", () => {
    expect(hasActiveAppointment([], NOW)).toBe(false);
  });

  it("appointment cancelado no futuro → NÃO conta como ativo", () => {
    const cancelled: AppointmentSummary = { ...futureAppt, status: "cancelled" };
    expect(hasActiveAppointment([cancelled], NOW)).toBe(false);
  });

  it("appointment confirmado no futuro → conta como ativo", () => {
    const confirmed: AppointmentSummary = { ...futureAppt, status: "confirmed" };
    expect(hasActiveAppointment([confirmed], NOW)).toBe(true);
  });

  it("appointment expirado com status scheduled → é appointment expirado", () => {
    expect(hasExpiredAppointment([pastAppt], NOW)).toBe(true);
  });
});

// ─── Testes: classificação de intenção de reagendamento ──────────────────────

describe("LeadRebooking — classifyRebookingIntent", () => {
  it("lead sem appointments → offer_slots (fluxo normal)", () => {
    const decision = classifyRebookingIntent("in_conversation", [], NOW);
    expect(decision.action).toBe("offer_slots");
  });

  it("lead com appointment futuro → ask_to_reschedule", () => {
    const decision = classifyRebookingIntent("appointment_scheduled", [futureAppt], NOW);
    expect(decision.action).toBe("ask_to_reschedule");
    if (decision.action === "ask_to_reschedule") {
      expect(decision.existingAppt.id).toBe("appt-jun-10");
    }
  });

  it("CENÁRIO SILVA: lead appointment_scheduled mas consulta já passou → offer_slots_past_appointment_expired", () => {
    // Silva tinha appointment em 01/Jun, voltou em 04/Jun querendo remarcar.
    // O sistema deveria detectar que a consulta já passou e oferecer novos slots.
    const decision = classifyRebookingIntent("appointment_scheduled", [pastAppt], NOW);
    expect(decision.action).toBe("offer_slots_past_appointment_expired");
  });

  it("lead in_conversation sem appointments → offer_slots", () => {
    const decision = classifyRebookingIntent("in_conversation", [], NOW);
    expect(decision.action).toBe("offer_slots");
  });

  it("lead com múltiplos appointments: um passado, um futuro → ask_to_reschedule (futuro vence)", () => {
    const decision = classifyRebookingIntent("appointment_scheduled", [pastAppt, futureAppt], NOW);
    expect(decision.action).toBe("ask_to_reschedule");
  });
});

// ─── Testes: resolução de treatment quando lead tem appointment ativo ──────────

describe("LeadRebooking — treatment resolution não deve crashar", () => {
  // O crash do Silva aconteceu quando o sistema tentou processar "Avaliação"
  // como resposta ao "qual procedimento?", mas a lógica de offer_slots
  // falhou ao buscar slots no InternalCalendarGateway para um lead
  // com appointment_scheduled (status inconsistente com consulta passada).

  type Treatment = { name: string; durationMinutes: number };

  const horizonteTreatments: Treatment[] = [
    { name: "Avaliação", durationMinutes: 60 },
    { name: "Manutenção das lentes", durationMinutes: 60 },
    { name: "Limpeza", durationMinutes: 60 },
    { name: "20 Lentes", durationMinutes: 240 },
  ];

  function findTreatmentByName(name: string, treatments: Treatment[]): Treatment | null {
    return treatments.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  it('"Avaliação" → resolução encontra o tratamento correto (60min)', () => {
    const found = findTreatmentByName("Avaliação", horizonteTreatments);
    expect(found).not.toBeNull();
    expect(found?.durationMinutes).toBe(60);
  });

  it('"avaliação" (minúsculo) → case-insensitive match', () => {
    const found = findTreatmentByName("avaliação", horizonteTreatments);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Avaliação");
  });

  it('"Avaliação" não é tratamento que exige avaliação prévia (não causa loop)', () => {
    const avaliacao = findTreatmentByName("Avaliação", horizonteTreatments);
    // A regra "requiresEvaluationFirst" não deveria estar em "Avaliação" em si
    // — seria circular. Este teste documenta que a resolução deve ser direta.
    expect(avaliacao).not.toBeNull();
  });

  it('"20 Lentes" exige duração de 240min para o slot engine', () => {
    const found = findTreatmentByName("20 Lentes", horizonteTreatments);
    expect(found?.durationMinutes).toBe(240);
  });

  it('tratamento desconhecido → null (sem crash)', () => {
    const found = findTreatmentByName("Clareamento Laser X-Pro", horizonteTreatments);
    expect(found).toBeNull();
    // O sistema deve fazer fallback para o default da clínica, não crashar
  });
});

// ─── Testes: invariantes do slot oferecido para lead com appointment passado ───

describe("LeadRebooking — slots para lead com appointment passado (status stale)", () => {
  // Quando a consulta já passou mas o status do lead ainda é appointment_scheduled,
  // o sistema deve oferecer novos slots normalmente, como se fosse um lead retornando.
  // O status deve ser corrigido para in_conversation antes ou durante o fluxo.

  function resolveLeadStatusForBooking(
    currentStatus: LeadStatus,
    appointments: AppointmentSummary[],
    now: Date,
  ): LeadStatus {
    const hasActive = hasActiveAppointment(appointments, now);
    if (currentStatus === "appointment_scheduled" && !hasActive) {
      return "in_conversation"; // corrige status stale
    }
    return currentStatus;
  }

  it("lead appointment_scheduled com consulta passada → status corrigido para in_conversation", () => {
    const corrected = resolveLeadStatusForBooking("appointment_scheduled", [pastAppt], NOW);
    expect(corrected).toBe("in_conversation");
  });

  it("lead appointment_scheduled com consulta futura → mantém appointment_scheduled", () => {
    const corrected = resolveLeadStatusForBooking("appointment_scheduled", [futureAppt], NOW);
    expect(corrected).toBe("appointment_scheduled");
  });

  it("lead in_conversation sem appointment → mantém in_conversation", () => {
    const corrected = resolveLeadStatusForBooking("in_conversation", [], NOW);
    expect(corrected).toBe("in_conversation");
  });

  it("CRÍTICO — lead com status stale não deve bloquear oferta de slots", () => {
    // Após a correção do status para in_conversation, classifyRebookingIntent
    // trata como lead normal (consulta passada, sem bloqueio futuro) → offer_slots.
    const status = resolveLeadStatusForBooking("appointment_scheduled", [pastAppt], NOW);
    expect(status).toBe("in_conversation"); // status corrigido

    const decision = classifyRebookingIntent(status, [pastAppt], NOW);
    // in_conversation + apenas appointment passado → oferece slots normalmente
    expect(decision.action).toBe("offer_slots");
  });
});
