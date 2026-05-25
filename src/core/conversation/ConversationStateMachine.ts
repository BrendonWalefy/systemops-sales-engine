// Substitui os marcadores __calendar_slots__: nos corpos de mensagem.
// O estado da conversa fica em uma tabela dedicada — auditável, recuperável, sem parsing de texto.

import { db } from "@/infrastructure/db/client";
import { conversationStates } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

export type ConversationStateType =
  | "idle"
  | "slots_offered"
  | "awaiting_confirmation"
  | "booking_pending";

export type FormattedSlot = {
  index: number;       // 1, 2, 3 — o número que o lead vê
  startsAt: string;    // ISO UTC string
  endsAt: string;      // ISO UTC string
  label: string;       // "Seg 26/05 às 14h"
};

export type SlotsOfferedPayload = {
  slots: FormattedSlot[];
  expiresAt: string; // ISO UTC
};

type StatePayload = SlotsOfferedPayload | Record<string, unknown>;

export type ConversationStateRow = {
  id: string;
  conversationId: string;
  state: ConversationStateType;
  payload: StatePayload | null;
  createdAt: Date;
  expiresAt: Date | null;
};

// Quanto tempo uma oferta de slots fica válida
const SLOT_OFFER_TTL_MINUTES = 15;

export class ConversationStateMachine {
  // Estado atual não-expirado da conversa
  async getCurrentState(conversationId: string): Promise<ConversationStateRow | null> {
    const rows = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.conversationId, conversationId))
      .orderBy(desc(conversationStates.createdAt))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    // Verifica expiração
    if (row.expiresAt && row.expiresAt < new Date()) return null;

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

  // Retorna slots da oferta vigente, ou null se não há oferta ativa
  async getPendingSlotOffer(conversationId: string): Promise<FormattedSlot[] | null> {
    const state = await this.getCurrentState(conversationId);
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
  ): Promise<FormattedSlot[]> {
    const formatted: FormattedSlot[] = slots.map((s, i) => ({
      index: i + 1,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      label: timezone.formatForHuman(s.startsAt),
    }));

    const expiresAt = new Date(Date.now() + SLOT_OFFER_TTL_MINUTES * 60_000);

    await db.insert(conversationStates).values({
      conversationId,
      state: "slots_offered",
      payload: { slots: formatted, expiresAt: expiresAt.toISOString() } satisfies SlotsOfferedPayload,
      expiresAt,
    });

    return formatted;
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
}
