// Anti-double-booking via lock otimista no banco de dados.
// Antes de criar evento no Google Calendar, reserva o slot com TTL.
// Duas requisições simultâneas para o mesmo slot: a segunda recebe null (slot ocupado).

import { db } from "@/infrastructure/db/client";
import { slotReservations } from "@/infrastructure/db/schema";
import { and, eq, gt, lt, or } from "drizzle-orm";

// Deve ser >= SLOT_OFFER_TTL_MINUTES (ConversationStateMachine) para o lead não
// tentar confirmar dentro da janela de oferta com a reserva já expirada.
const RESERVATION_TTL_MINUTES = 15;

export type SlotReservation = {
  id: string;
  clinicId: string;
  leadId: string;
  startsAt: Date;
  endsAt: Date;
  status: "pending" | "confirmed" | "released";
  calendarEventId: string | null;
  expiresAt: Date;
};

export class SlotReservationService {
  async findActiveByPeriod(
    clinicId: string,
    from: Date,
    to: Date,
    now: Date = new Date(),
  ): Promise<SlotReservation[]> {
    const rows = await db
      .select()
      .from(slotReservations)
      .where(
        and(
          eq(slotReservations.clinicId, clinicId),
          lt(slotReservations.startsAt, to),
          gt(slotReservations.endsAt, from),
          or(
            eq(slotReservations.status, "confirmed"),
            and(
              eq(slotReservations.status, "pending"),
              gt(slotReservations.expiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(slotReservations.startsAt);
    return rows.map((row) => ({
      id: row.id,
      clinicId: row.clinicId,
      leadId: row.leadId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status as SlotReservation["status"],
      calendarEventId: row.calendarEventId,
      expiresAt: row.expiresAt,
    }));
  }

  // Tenta reservar um slot. Retorna null se já está reservado/confirmado por outro lead.
  // A constraint UNIQUE (clinic_id, starts_at) com status pending/confirmed previne concorrência.
  async reserve(
    clinicId: string,
    leadId: string,
    startsAt: Date,
    endsAt: Date,
    ttlMinutes: number = RESERVATION_TTL_MINUTES,
  ): Promise<SlotReservation | null> {
    // Limpa expirados antes de tentar reservar
    await this.releaseExpired();

    // Verifica se já há reserva ativa (pending ou confirmed) que se sobreponha ao slot.
    // Usa detecção de intervalo (overlap) em vez de match exato no startsAt para capturar
    // conflitos com slots de durações diferentes (ex: consulta de 45 min vs slot de 60 min).
    const existing = await db
      .select()
      .from(slotReservations)
      .where(
        and(
          eq(slotReservations.clinicId, clinicId),
          lt(slotReservations.startsAt, endsAt),
          gt(slotReservations.endsAt, startsAt),
          or(
            eq(slotReservations.status, "pending"),
            eq(slotReservations.status, "confirmed"),
          ),
        ),
      )
      .limit(1);

    if (existing.length > 0) return null;

    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    // Reuso de linha released: a exclusion constraint (clinic_id, tstzrange)
    // valida o overlap atomicamente no UPDATE — violação = slot tomado.
    let reused: typeof slotReservations.$inferSelect | undefined;
    try {
      [reused] = await db
        .update(slotReservations)
        .set({
          leadId,
          endsAt,
          status: "pending",
          calendarEventId: null,
          expiresAt,
        })
        .where(
          and(
            eq(slotReservations.clinicId, clinicId),
            eq(slotReservations.startsAt, startsAt),
            eq(slotReservations.status, "released"),
          ),
        )
        .returning();
    } catch {
      // Violação da exclusion constraint — outra reserva sobreposta venceu a corrida
      return null;
    }

    if (reused) {
      return {
        id: reused.id,
        clinicId: reused.clinicId,
        leadId: reused.leadId,
        startsAt: reused.startsAt,
        endsAt: reused.endsAt,
        status: reused.status as SlotReservation["status"],
        calendarEventId: reused.calendarEventId,
        expiresAt: reused.expiresAt,
      };
    }

    const id = crypto.randomUUID();

    try {
      await db.insert(slotReservations).values({
        id,
        clinicId,
        leadId,
        startsAt,
        endsAt,
        status: "pending",
        calendarEventId: null,
        expiresAt,
      });

      return {
        id,
        clinicId,
        leadId,
        startsAt,
        endsAt,
        status: "pending",
        calendarEventId: null,
        expiresAt,
      };
    } catch {
      // INSERT falhou por race condition (outra requisição ganhou) — cobre
      // tanto a unique (clinic_id, starts_at) quanto a exclusion de overlap.
      return null;
    }
  }

  // Busca uma reserva por id (usada pelo fluxo de sinal para reaproveitar o hold do
  // lead ao confirmar via operador, em vez de tentar reservar de novo e colidir consigo).
  async findById(reservationId: string): Promise<SlotReservation | null> {
    const rows = await db
      .select()
      .from(slotReservations)
      .where(eq(slotReservations.id, reservationId))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      clinicId: r.clinicId,
      leadId: r.leadId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status as SlotReservation["status"],
      calendarEventId: r.calendarEventId,
      expiresAt: r.expiresAt,
    };
  }

  // Estende o TTL de uma reserva pendente (ex.: comprovante chegou, dar tempo ao
  // operador validar sem o hold expirar). No-op se não estiver mais pendente.
  async extend(reservationId: string, ttlMinutes: number): Promise<void> {
    await db
      .update(slotReservations)
      .set({ expiresAt: new Date(Date.now() + ttlMinutes * 60_000) })
      .where(
        and(
          eq(slotReservations.id, reservationId),
          eq(slotReservations.status, "pending"),
        ),
      );
  }

  // Confirma a reserva após criar evento no Google Calendar com sucesso
  async confirm(reservationId: string, calendarEventId: string | null): Promise<void> {
    await db
      .update(slotReservations)
      .set({ status: "confirmed", calendarEventId })
      .where(eq(slotReservations.id, reservationId));
  }

  // Libera manualmente uma reserva pendente (ex: usuário cancelou no meio)
  async release(reservationId: string): Promise<void> {
    await db
      .update(slotReservations)
      .set({ status: "released" })
      .where(
        and(
          eq(slotReservations.id, reservationId),
          eq(slotReservations.status, "pending"),
        ),
      );
  }

  // Libera a reserva confirmada de um slot ao cancelar o agendamento.
  // Necessário para que o slot volte a ser reservável após cancelamento.
  async releaseBySlot(clinicId: string, startsAt: Date): Promise<void> {
    await db
      .update(slotReservations)
      .set({ status: "released" })
      .where(
        and(
          eq(slotReservations.clinicId, clinicId),
          eq(slotReservations.startsAt, startsAt),
          eq(slotReservations.status, "confirmed"),
        ),
      );
  }

  // Remove reservas cujo TTL expirou — chamado no início de cada ciclo de booking
  async releaseExpired(): Promise<void> {
    await db
      .update(slotReservations)
      .set({ status: "released" })
      .where(
        and(
          eq(slotReservations.status, "pending"),
          lt(slotReservations.expiresAt, new Date()),
        ),
      );
  }
}
