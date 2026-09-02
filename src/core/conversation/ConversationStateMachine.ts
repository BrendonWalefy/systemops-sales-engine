// Substitui os marcadores __calendar_slots__: nos corpos de mensagem.
// O estado da conversa fica em uma tabela dedicada — auditável, recuperável, sem parsing de texto.

import { createHash } from "node:crypto";
import { db } from "@/infrastructure/db/client";
import { conversationStates } from "@/infrastructure/db/schema";
import { and, eq, desc, lte, sql } from "drizzle-orm";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { Treatment } from "@/domain/entities/treatment";
import { runtimeNow } from "@/core/time/RuntimeClock";

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
  professionalId?: string;
};

export type SlotsOfferedPayload = {
  slots: FormattedSlot[];
  expiresAt: string; // ISO UTC
  treatmentId?: string;
  treatmentName?: string;
  durationMinutes?: number;
  professionalId?: string;
  replacesAppointmentId?: string;
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
  supersedesStateId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

// Quanto tempo uma oferta de slots fica válida
export const SLOT_OFFER_TTL_MINUTES = 15;

export type PipelineAdvanceExpectation = {
  treatmentId?: string;
  stepIndex?: number;
};

export type StartTreatmentPipelineForTurnInput = Readonly<{
  conversationId: string;
  turnId: string;
  treatmentId: string;
  treatmentName: string;
  ttlMinutes: number;
  stepIndex: number;
  selectedTreatment: Readonly<{ id: string; name: string }> | null;
  expectedCurrentStateId: string | null;
}>;

export type ExactStateTransitionResult = Readonly<{
  applied: boolean;
  state: ConversationStateRow | null;
}>;

function deterministicStateId(input: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(input).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function matchesPipelineAdvanceExpectation(
  current: TreatmentPipelinePayload,
  expected?: PipelineAdvanceExpectation,
): boolean {
  if (expected?.treatmentId && current.treatmentId !== expected.treatmentId) return false;
  if (expected?.stepIndex != null && current.stepIndex !== expected.stepIndex) return false;
  return true;
}

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
      .orderBy(desc(conversationStates.createdAt), desc(conversationStates.id))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    // Verifica expiração explícita
    if (row.expiresAt && row.expiresAt < runtimeNow()) return null;
    // slots_offered sem expiresAt (rows criadas antes do TTL ser implementado) expiram pelo createdAt
    if (!row.expiresAt && row.state === "slots_offered") {
      if (runtimeNow().getTime() - row.createdAt.getTime() > SLOT_OFFER_TTL_MINUTES * 60_000) return null;
    }

    return {
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as ConversationStateType,
      payload: row.payload as StatePayload | null,
      supersedesStateId: row.supersedesStateId,
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
      ? new Date(runtimeNow().getTime() + ttlMinutes * 60_000)
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

  async invalidateIfCurrent(
    conversationId: string,
    expectedStateId: string,
  ): Promise<boolean> {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO ${conversationStates}
        (conversation_id, state, payload, supersedes_state_id, expires_at)
      SELECT ${conversationId}::uuid, 'idle', NULL::jsonb, ${expectedStateId}::uuid, NULL
      WHERE ${expectedStateId}::uuid = (
        SELECT ${conversationStates.id}
        FROM ${conversationStates}
        WHERE ${conversationStates.conversationId} = ${conversationId}::uuid
        ORDER BY ${conversationStates.createdAt} DESC, ${conversationStates.id} DESC
        LIMIT 1
      )
      ON CONFLICT (supersedes_state_id) DO NOTHING
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  // Invalida o estado e registra o momento do reset para que a próxima mensagem
  // receba apenas o histórico pós-reset (evita que o LLM reutilize mídias já enviadas).
  // TTL de 2h: após isso getCurrentState retorna null e o Orchestrator usa allMessages normalmente.
  async markResetBoundary(conversationId: string): Promise<void> {
    await db.insert(conversationStates).values({
      conversationId,
      state: "idle",
      payload: { lastResetAt: runtimeNow().toISOString() },
      expiresAt: new Date(runtimeNow().getTime() + 2 * 3600_000),
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
      if (row.expiresAt && row.expiresAt < runtimeNow()) continue;
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
    slots: Array<{ startsAt: Date; endsAt: Date; professionalId?: string | null }>,
    timezone: ClinicTimezone,
    treatmentName?: string,
    durationMinutes?: number,
    ttlMinutes?: number,
    voiceEnabled?: boolean,
    treatmentId?: string,
    professionalId?: string,
    replacesAppointmentId?: string,
  ): Promise<FormattedSlot[]> {
    return this.persistSlotOffer(
      undefined,
      conversationId,
      slots,
      timezone,
      treatmentName,
      durationMinutes,
      ttlMinutes,
      voiceEnabled,
      treatmentId,
      professionalId,
      replacesAppointmentId,
    );
  }

  // V2 live binds the persisted offer to a deterministic turn-scoped state id.
  // The write remains behind the prepared capability token.
  async offerSlotsForTurn(
    stateId: string,
    conversationId: string,
    slots: Array<{ startsAt: Date; endsAt: Date; professionalId?: string | null }>,
    timezone: ClinicTimezone,
    treatmentName?: string,
    durationMinutes?: number,
    ttlMinutes?: number,
    voiceEnabled?: boolean,
    treatmentId?: string,
    professionalId?: string,
    replacesAppointmentId?: string,
  ): Promise<FormattedSlot[]> {
    return this.persistSlotOffer(
      stateId,
      conversationId,
      slots,
      timezone,
      treatmentName,
      durationMinutes,
      ttlMinutes,
      voiceEnabled,
      treatmentId,
      professionalId,
      replacesAppointmentId,
    );
  }

  private async persistSlotOffer(
    stateId: string | undefined,
    conversationId: string,
    slots: Array<{ startsAt: Date; endsAt: Date; professionalId?: string | null }>,
    timezone: ClinicTimezone,
    treatmentName?: string,
    durationMinutes?: number,
    ttlMinutes?: number,
    voiceEnabled?: boolean,
    treatmentId?: string,
    professionalId?: string,
    replacesAppointmentId?: string,
  ): Promise<FormattedSlot[]> {
    const formatted: FormattedSlot[] = slots.map((s, i) => ({
      index: i + 1,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      label: voiceEnabled ? timezone.formatForVoice(s.startsAt) : timezone.formatForHuman(s.startsAt),
      ...(s.professionalId ? { professionalId: s.professionalId } : {}),
    }));

    const expiresAt = new Date(runtimeNow().getTime() + (ttlMinutes ?? SLOT_OFFER_TTL_MINUTES) * 60_000);
    const payload: SlotsOfferedPayload = {
      slots: formatted,
      expiresAt: expiresAt.toISOString(),
      ...(treatmentId && { treatmentId }),
      ...(treatmentName && { treatmentName }),
      ...(durationMinutes && { durationMinutes }),
      ...(professionalId && { professionalId }),
      ...(replacesAppointmentId && { replacesAppointmentId }),
    };

    await db.insert(conversationStates).values({
      ...(stateId ? { id: stateId } : {}),
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
      expiresAt: new Date(runtimeNow().getTime() + 30 * 60_000),
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
      expiresAt: new Date(runtimeNow().getTime() + 30 * 60_000),
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

    const now = runtimeNow();
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
      expiresAt: new Date(runtimeNow().getTime() + ttlMinutes * 60_000),
    });
  }

  /**
   * Starts one exact journey revision for a claimed V2 turn. The durable turn ID
   * makes replay idempotent; `supersedes_state_id` arbitrates a known predecessor.
   * Conversation-turn leasing remains the authority that serializes two distinct
   * first turns when no predecessor exists.
   */
  async startTreatmentPipelineForTurn(
    input: StartTreatmentPipelineForTurnInput,
  ): Promise<ExactStateTransitionResult> {
    const id = deterministicStateId(`treatment-pipeline:${input.turnId}`);
    const now = runtimeNow();
    const payload: TreatmentPipelinePayload = {
      treatmentId: input.treatmentId,
      treatmentName: input.treatmentName,
      ...(input.selectedTreatment && input.selectedTreatment.id !== input.treatmentId
        ? {
            selectedTreatmentId: input.selectedTreatment.id,
            selectedTreatmentName: input.selectedTreatment.name,
          }
        : {}),
      stepIndex: input.stepIndex,
      qaTurns: 0,
      photoReceived: false,
    };
    const inserted = await db.execute<ConversationStateRow>(sql`
      INSERT INTO ${conversationStates}
        (id, conversation_id, state, payload, supersedes_state_id, created_at, expires_at)
      SELECT
        ${id}::uuid,
        ${input.conversationId}::uuid,
        'treatment_pipeline_active',
        ${JSON.stringify(payload)}::jsonb,
        ${input.expectedCurrentStateId}::uuid,
        now(),
        ${new Date(now.getTime() + input.ttlMinutes * 60_000)}
      WHERE (
        ${input.expectedCurrentStateId}::uuid IS NOT NULL
        AND ${input.expectedCurrentStateId}::uuid = (
          SELECT ${conversationStates.id}
          FROM ${conversationStates}
          WHERE ${conversationStates.conversationId} = ${input.conversationId}::uuid
          ORDER BY ${conversationStates.createdAt} DESC, ${conversationStates.id} DESC
          LIMIT 1
        )
      ) OR (
        ${input.expectedCurrentStateId}::uuid IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${conversationStates}
          WHERE ${conversationStates.conversationId} = ${input.conversationId}::uuid
            AND (${conversationStates.expiresAt} IS NULL OR ${conversationStates.expiresAt} >= ${now})
        )
      )
      ON CONFLICT DO NOTHING
      RETURNING
        id,
        conversation_id AS "conversationId",
        state,
        payload,
        supersedes_state_id AS "supersedesStateId",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
    `);
    const row = inserted.rows[0]
      ?? (await db.select().from(conversationStates).where(eq(conversationStates.id, id)).limit(1))[0]
      ?? null;
    if (!row) {
      return { applied: false, state: await this.getCurrentState(input.conversationId) };
    }
    return {
      applied: inserted.rows.length === 1,
      state: {
        id: row.id,
        conversationId: row.conversationId,
        state: row.state as ConversationStateType,
        payload: row.payload as StatePayload | null,
        supersedesStateId: row.supersedesStateId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      },
    };
  }

  // Retorna o estado atual do pipeline, ou null se não houver pipeline ativo.
  async getTreatmentPipelineState(conversationId: string, createdAtOrBefore?: Date): Promise<TreatmentPipelinePayload | null> {
    const state = await this.getCurrentState(conversationId, createdAtOrBefore);
    if (!state || state.state !== "treatment_pipeline_active") return null;
    return state.payload as TreatmentPipelinePayload;
  }

  // Avança o pipeline para o próximo passo, preservando TTL original.
  async advancePipelineStep(
    conversationId: string,
    nextStepIndex: number,
    expected?: PipelineAdvanceExpectation,
  ): Promise<boolean> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "treatment_pipeline_active") return false;
    const current = state.payload as TreatmentPipelinePayload;
    if (!matchesPipelineAdvanceExpectation(current, expected)) return false;
    const inserted = await db
      .insert(conversationStates)
      .values({
        conversationId,
        state: "treatment_pipeline_active",
        payload: { ...current, stepIndex: nextStepIndex, qaTurns: 0 } satisfies TreatmentPipelinePayload,
        supersedesStateId: state.id,
        expiresAt: state.expiresAt,
      })
      .onConflictDoNothing({ target: conversationStates.supersedesStateId })
      .returning({ id: conversationStates.id });
    return inserted.length > 0;
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
  async exitTreatmentPipeline(
    conversationId: string,
    expected?: PipelineAdvanceExpectation,
  ): Promise<boolean> {
    const state = await this.getCurrentState(conversationId);
    if (!state || state.state !== "treatment_pipeline_active") return false;
    const current = state.payload as TreatmentPipelinePayload;
    if (!matchesPipelineAdvanceExpectation(current, expected)) return false;
    const inserted = await db
      .insert(conversationStates)
      .values({
        conversationId,
        state: "idle",
        payload: null,
        supersedesStateId: state.id,
        expiresAt: null,
      })
      .onConflictDoNothing({ target: conversationStates.supersedesStateId })
      .returning({ id: conversationStates.id });
    return inserted.length > 0;
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
      expiresAt: new Date(runtimeNow().getTime() + ttlMinutes * 60_000),
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
      expiresAt: new Date(runtimeNow().getTime() + ttlMinutes * 60_000),
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
        proofReceivedAt: runtimeNow().toISOString(),
        ...(proofReviewCode ? { proofReviewCode } : {}),
      } satisfies DepositFlowPayload,
      expiresAt: new Date(runtimeNow().getTime() + 7 * 24 * 3600_000),
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
