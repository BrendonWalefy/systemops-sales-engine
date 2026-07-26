// Substitui os marcadores __calendar_slots__: nos corpos de mensagem.
// O estado da conversa fica em uma tabela dedicada — auditável, recuperável, sem parsing de texto.

import { db } from "@/infrastructure/db/client";
import { conversationStates } from "@/infrastructure/db/schema";
import { and, eq, desc, lte } from "drizzle-orm";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { Treatment } from "@/domain/entities/treatment";

export type ConversationStateType =
  | "idle"
  | "slots_offered"
  | "awaiting_confirmation"
  | "booking_pending"
  | "menu_offered"
  | "procedure_list_offered"
  | "treatment_pipeline_active"
  | "awaiting_appointment_confirmation"
  // Fluxo de sinal: lead escolheu o slot, aguardando o comprovante do Pix.
  | "awaiting_deposit_proof"
  // Comprovante recebido; aguardando o operador validar e confirmar.
  | "deposit_proof_received";

export type FormattedSlot = {
  index: number;       // 1, 2, 3 — o número que o lead vê
  startsAt: string;    // ISO UTC string
  endsAt: string;      // ISO UTC string
  label: string;       // "Seg 26/05 às 14h"
};

export type SlotsOfferedPayload = {
  slots: FormattedSlot[];
  expiresAt: string; // ISO UTC
  treatmentName?: string;
  durationMinutes?: number;
};

export type ProcedureListItem = {
  index: number;
  treatmentId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  requiresEvaluationFirst: boolean;
  // Dado estruturado do tratamento. Nunca inferir no runtime pelo nome.
  isAesthetic?: boolean;
};

export type ProcedureListPayload = {
  treatments: ProcedureListItem[];
};

export type TreatmentPipelinePayload = {
  // Dono canônico do pipeline e de seus content blocks.
  treatmentId: string;
  treatmentName: string;
  // Variante comercial originalmente escolhida. Preço, duração e agendamento
  // continuam pertencendo a ela, mesmo quando a jornada vem do tratamento pai.
  selectedTreatmentId?: string;
  selectedTreatmentName?: string;
  stepIndex: number;
  qaTurns: number;
  photoReceived: boolean;
};

export type AppointmentConfirmationPayload = {
  appointmentId: string;
  appointmentLabel: string;
};

// Fluxo de sinal: dados necessários para cobrar o sinal, segurar o slot e, quando o
// operador confirmar, criar o agendamento com os mesmos horário/valor.
export type DepositFlowPayload = {
  slotStartsAt: string; // ISO UTC
  slotEndsAt: string;   // ISO UTC
  slotLabel: string;    // "Seg 26/05 às 09h"
  reservationId: string | null; // null quando shadow mode pulou a reserva
  treatmentId: string | null;
  treatmentName?: string;
  valueCents: number | null;
  depositAmountCents: number;
  holdExpiresAt: string; // ISO UTC
  proofMessageId?: string;
  proofReceivedAt?: string;
  proofReviewCode?: number;
};

type StatePayload = SlotsOfferedPayload | ProcedureListPayload | TreatmentPipelinePayload | AppointmentConfirmationPayload | DepositFlowPayload | Record<string, unknown>;

export type ConversationStateRow = {
  id: string;
  conversationId: string;
  state: ConversationStateType;
  payload: StatePayload | null;
  createdAt: Date;
  expiresAt: Date | null;
};

// Quanto tempo uma oferta de slots fica válida
export const SLOT_OFFER_TTL_MINUTES = 15;

export class ConversationStateMachine {
  // Estado atual não-expirado da conversa
  async getCurrentState(conversationId: string, createdAtOrBefore?: Date): Promise<ConversationStateRow | null> {
    const rows = await db
      .select()
      .from(conversationStates)
      .where(
        createdAtOrBefore
          ? and(
              eq(conversationStates.conversationId, conversationId),
              lte(conversationStates.createdAt, createdAtOrBefore),
            )
          : eq(conversationStates.conversationId, conversationId),
      )
      .orderBy(desc(conversationStates.createdAt))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    // Verifica expiração explícita
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    // slots_offered sem expiresAt (rows criadas antes do TTL ser implementado) expiram pelo createdAt
    if (!row.expiresAt && row.state === "slots_offered") {
      if (Date.now() - row.createdAt.getTime() > SLOT_OFFER_TTL_MINUTES * 60_000) return null;
    }

    return {
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as ConversationStateType,
      payload: row.payload as StatePayload | null,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  // Transiciona para um novo estado
  async transition(
    conversationId: string,
    state: ConversationStateType,
    payload?: StatePayload,
    ttlMinutes?: number,
  ): Promise<void> {
    const expiresAt = ttlMinutes
      ? new Date(Date.now() + ttlMinutes * 60_000)
      : null;

    await db.insert(conversationStates).values({
      conversationId,
      state,
      payload: payload ?? null,
      expiresAt,
    });
  }

  // Invalida o estado atual registrando transição para idle
  // Chamado quando lead manda nova mensagem fora do contexto de escolha de slot
  async invalidate(conversationId: string): Promise<void> {
    await db.insert(conversationStates).values({
      conversationId,
      state: "idle",
      payload: null,
      expiresAt: null,
    });
  }

  // Invalida o estado e registra o momento do reset para que a próxima mensagem
  // receba apenas o histórico pós-reset (evita que o LLM reutilize mídias já enviadas).
  // TTL de 2h: após isso getCurrentState retorna null e o Orchestrator usa allMessages normalmente.
  async markResetBoundary(conversationId: string): Promise<void> {
    await db.insert(conversationStates).values({
      conversationId,
      state: "idle",
      payload: { lastResetAt: new Date().toISOString() },
      expiresAt: new Date(Date.now() + 2 * 3600_000),
    });
  }

  async getLastResetBoundary(conversationId: string): Promise<Date | null> {
    const rows = await db
      .select({ payload: conversationStates.payload, expiresAt: conversationStates.expiresAt })
      .from(conversationStates)
      .where(eq(conversationStates.conversationId, conversationId))
      .orderBy(desc(conversationStates.createdAt))
      .limit(20);

    for (const row of rows) {
      if (row.expiresAt && row.expiresAt < new Date()) continue;
      const payload = row.payload as { lastResetAt?: string } | null;
      if (!payload?.lastResetAt) continue;
      return new Date(payload.lastResetAt);
    }
    return null;
  }

  // Retorna slots da oferta vigente, ou null se não há oferta ativa
  async getPendingSlotOffer(conversationId: string, createdAtOrBefore?: Date): Promise<FormattedSlot[] | null> {
    const state = await this.getCurrentState(conversationId, createdAtOrBefore);
    if (!state || state.state !== "slots_offered") return null;

    const payload = state.payload as SlotsOfferedPayload | null;
    if (!payload?.slots?.length) return null;

    return payload.slots;
  }

  // Salva oferta de slots com TTL de 15 minutos
  async offerSlots(
    conversationId: string,
    slots: Array<{ startsAt: Date; endsAt: Date }>,
    timezone: ClinicTimezone,
    treatmentName?: string,
    durationMinutes?: number,
    ttlMinutes?: number,
    voiceEnabled?: boolean,
  ): Promise<FormattedSlot[]> {
    const formatted: FormattedSlot[] = slots.map((s, i) => ({
      index: i + 1,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      label: voiceEnabled ? timezone.formatForVoice(s.startsAt) : timezone.formatForHuman(s.startsAt),
    }));

    const expiresAt = new Date(Date.now() + (ttlMinutes ?? SLOT_OFFER_TTL_MINUTES) * 60_000);
    const payload: SlotsOfferedPayload = {
      slots: formatted,
      expiresAt: expiresAt.toISOString(),
      ...(treatmentName && { treatmentName }),
      ...(durationMinutes && { durationMinutes }),
    };

    await db.insert(conversationStates).values({
      conversationId,
      state: "slots_offered",
      payload,
      expiresAt,
    });

    return formatted;
  }

  // Registra que o menu de opções foi apresentado ao lead (TTL: 30 min)
  async offerMenu(conversationId: string): Promise<void> {
    await db.insert(conversationStates).values({
      conversationId,
      state: "menu_offered",
      payload: null,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
  }

  // Retorna true se o lead ainda está dentro do TTL de escolha do menu
  async isMenuOffered(conversationId: string): Promise<boolean> {
    const state = await this.getCurrentState(conversationId);
    return state?.state === "menu_offered";
  }

  // Salva lista numerada de procedimentos com TTL de 30 minutos
  async offerProcedureList(conversationId: string, treatments: Treatment[]): Promise<ProcedureListItem[]> {
    const items: ProcedureListItem[] = treatments.map((t, i) => ({
      index: i + 1,
      treatmentId: t.id,
      name: t.name,
      description: t.description,
      durationMinutes: t.durationMinutes,
      requiresEvaluationFirst: t.requiresEvaluationFirst,
      isAesthetic: t.isAesthetic,
    }));

    await db.insert(conversationStates).values({
      conversationId,
      state: "procedure_list_offered",
      payload: { treatments: items },
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    return items;
  }

  async getOfferedProcedureByIndex(
    conversationId: string,
    rawSelection: string,
    createdAtOrBefore?: Date,
  ): Promise<ProcedureListItem | null> {
    const state = await this.getCurrentState(conversationId, createdAtOrBefore);
    if (!state || state.state !== "procedure_list_offered") return null;

    const normalized = rawSelection.trim();
    if (!/^\d+$/.test(normalized)) return null;

    const payload = state.payload as ProcedureListPayload | null;
    if (!payload?.treatments?.length) return null;

    const index = Number(normalized);
    return payload.treatments.find((item) => item.index === index) ?? null;
  }

  // Retorna o nome do tratamento associado à oferta vigente, se houver
  async getOfferedTreatment(conversationId: string): Promise<{ treatmentName?: string; durationMinutes?: number } | null> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "slots_offered") return null;

    const payload = state.payload as SlotsOfferedPayload | null;
    return payload ? { treatmentName: payload.treatmentName, durationMinutes: payload.durationMinutes } : null;
  }

  // Recupera um slot específico por índice (1-based) da oferta vigente
  async getOfferedSlotByIndex(
    conversationId: string,
    index: number,
  ): Promise<{ startsAt: Date; endsAt: Date } | null> {
    const slots = await this.getPendingSlotOffer(conversationId);
    if (!slots) return null;

    const slot = slots.find((s) => s.index === index);
    if (!slot) return null;

    return {
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
    };
  }

  // Recupera apenas a intenção numérica de uma oferta que acabou de expirar.
  // Não devolve o slot antigo para confirmação: o Orchestrator deve atualizar a
  // agenda e responder com `slots_expired`. Considera somente o estado mais
  // recente, evitando que um número de menu seja ligado a uma oferta antiga.
  async getRecentlyExpiredSlotSelection(
    conversationId: string,
    rawSelection: string,
    createdAtOrBefore?: Date,
    maxAgeHours = 24,
  ): Promise<number | null> {
    const normalized = rawSelection.trim();
    if (!/^\d+$/.test(normalized)) return null;

    const [row] = await db
      .select()
      .from(conversationStates)
      .where(
        createdAtOrBefore
          ? and(
              eq(conversationStates.conversationId, conversationId),
              lte(conversationStates.createdAt, createdAtOrBefore),
            )
          : eq(conversationStates.conversationId, conversationId),
      )
      .orderBy(desc(conversationStates.createdAt))
      .limit(1);
    if (!row || row.state !== "slots_offered") return null;

    const now = new Date();
    const effectiveExpiry = row.expiresAt ?? new Date(row.createdAt.getTime() + SLOT_OFFER_TTL_MINUTES * 60_000);
    if (effectiveExpiry >= now) return null;
    if (now.getTime() - effectiveExpiry.getTime() > maxAgeHours * 60 * 60_000) return null;

    const index = Number(normalized);
    const payload = row.payload as SlotsOfferedPayload | null;
    return payload?.slots?.some((slot) => slot.index === index) ? index : null;
  }

  // ─── Pipeline de tratamento ───────────────────────────────────────────────

  // Inicia o pipeline para um tratamento. TTL: 4 horas (mesmo que staleConversationHours default).
  // startStepIndex permite posicionar o pipeline já em um passo específico sem emiti-lo —
  // usado para "deferir" o passo de conteúdo no 1º contato concierge (envia só o opener de
  // qualificação; o conteúdo/mídia dispara na continuação, na próxima mensagem do lead).
  async startTreatmentPipeline(
    conversationId: string,
    treatmentId: string,
    treatmentName: string,
    ttlMinutes = 240,
    startStepIndex = 0,
    selectedTreatment?: { id: string; name: string } | null,
  ): Promise<void> {
    const payload: TreatmentPipelinePayload = {
      treatmentId,
      treatmentName,
      ...(selectedTreatment && selectedTreatment.id !== treatmentId
        ? {
            selectedTreatmentId: selectedTreatment.id,
            selectedTreatmentName: selectedTreatment.name,
          }
        : {}),
      stepIndex: startStepIndex,
      qaTurns: 0,
      photoReceived: false,
    };
    await db.insert(conversationStates).values({
      conversationId,
      state: "treatment_pipeline_active",
      payload,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });
  }

  // Retorna o estado atual do pipeline, ou null se não houver pipeline ativo.
  async getTreatmentPipelineState(conversationId: string, createdAtOrBefore?: Date): Promise<TreatmentPipelinePayload | null> {
    const state = await this.getCurrentState(conversationId, createdAtOrBefore);
    if (!state || state.state !== "treatment_pipeline_active") return null;
    return state.payload as TreatmentPipelinePayload;
  }

  // Avança o pipeline para o próximo passo, preservando TTL original.
  async advancePipelineStep(conversationId: string, nextStepIndex: number): Promise<void> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "treatment_pipeline_active") return;
    const current = state.payload as TreatmentPipelinePayload;
    await db.insert(conversationStates).values({
      conversationId,
      state: "treatment_pipeline_active",
      payload: { ...current, stepIndex: nextStepIndex, qaTurns: 0 } satisfies TreatmentPipelinePayload,
      expiresAt: state.expiresAt,
    });
  }

  // Incrementa o contador de turnos Q&A sem mudar de passo.
  async incrementPipelineQaTurns(conversationId: string): Promise<void> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "treatment_pipeline_active") return;
    const current = state.payload as TreatmentPipelinePayload;
    await db.insert(conversationStates).values({
      conversationId,
      state: "treatment_pipeline_active",
      payload: { ...current, qaTurns: current.qaTurns + 1 } satisfies TreatmentPipelinePayload,
      expiresAt: state.expiresAt,
    });
  }

  // Marca que a foto foi recebida (v2: intercept de mídia inbound).
  async markPipelinePhotoReceived(conversationId: string, reviewExpiresAt?: Date | null): Promise<void> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "treatment_pipeline_active") return;
    const current = state.payload as TreatmentPipelinePayload;
    await db.insert(conversationStates).values({
      conversationId,
      state: "treatment_pipeline_active",
      payload: { ...current, photoReceived: true } satisfies TreatmentPipelinePayload,
      // Durante revisão humana, o estado acompanha o TTL do caso para que a
      // retomada no dia seguinte ainda saiba que a foto foi recebida.
      expiresAt: reviewExpiresAt ?? state.expiresAt,
    });
  }

  // Encerra o pipeline. O fluxo reativo normal assume a partir daqui.
  async exitTreatmentPipeline(conversationId: string): Promise<void> {
    await this.invalidate(conversationId);
  }

  // ─── Confirmação de presença pelo lead (resposta ao lembrete D-1) ────────────

  // Registra que o lead recebeu o lembrete com pedido de confirmação. TTL: 24h.
  async offerAppointmentConfirmation(
    conversationId: string,
    appointmentId: string,
    appointmentLabel: string,
    ttlMinutes = 1440,
  ): Promise<void> {
    const payload: AppointmentConfirmationPayload = { appointmentId, appointmentLabel };
    await db.insert(conversationStates).values({
      conversationId,
      state: "awaiting_appointment_confirmation",
      payload,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });
  }

  // Retorna o payload da confirmação pendente, ou null se não há confirmação aguardando.
  async getAppointmentConfirmationState(conversationId: string): Promise<AppointmentConfirmationPayload | null> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "awaiting_appointment_confirmation") return null;
    return state.payload as AppointmentConfirmationPayload;
  }

  // ─── Fluxo de sinal (depósito) ───────────────────────────────────────────────

  // Registra que o lead escolheu o slot e recebeu o pedido de sinal. TTL = janela do
  // hold (depositTtlHours). Após expirar, o cron libera a reserva e avisa o lead.
  async startDepositWait(
    conversationId: string,
    payload: DepositFlowPayload,
    ttlMinutes: number,
  ): Promise<void> {
    await db.insert(conversationStates).values({
      conversationId,
      state: "awaiting_deposit_proof",
      payload,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });
  }

  // Marca que o comprovante chegou (qualquer imagem/PDF neste estado). TTL generoso
  // (7 dias) para dar tempo ao operador validar sem o estado expirar.
  async markDepositProofReceived(conversationId: string, proofMessageId: string, proofReviewCode?: number): Promise<void> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "awaiting_deposit_proof") return;
    const current = state.payload as DepositFlowPayload;
    await db.insert(conversationStates).values({
      conversationId,
      state: "deposit_proof_received",
      payload: {
        ...current,
        proofMessageId,
        proofReceivedAt: new Date().toISOString(),
        ...(proofReviewCode ? { proofReviewCode } : {}),
      } satisfies DepositFlowPayload,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    });
  }

  // Retorna o estado + payload do fluxo de sinal (aguardando comprovante OU
  // comprovante recebido), ou null se não está em fluxo de sinal.
  async getDepositState(
    conversationId: string,
    createdAtOrBefore?: Date,
  ): Promise<{ state: "awaiting_deposit_proof" | "deposit_proof_received"; payload: DepositFlowPayload } | null> {
    const state = await this.getCurrentState(conversationId, createdAtOrBefore);
    if (!state) return null;
    if (state.state !== "awaiting_deposit_proof" && state.state !== "deposit_proof_received") return null;
    return { state: state.state, payload: state.payload as DepositFlowPayload };
  }
}
