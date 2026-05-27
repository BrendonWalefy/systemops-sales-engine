// Anti-double-booking via lock otimista no banco de dados.
// Antes de criar evento no Google Calendar, reserva o slot com TTL.
// Duas requisições simultâneas para o mesmo slot: a segunda recebe null (slot ocupado).

import { db } from "@/infrastructure/db/client";
import { slotReservations } from "@/infrastructure/db/schema";
import { and, eq, gt, lt, or } from "drizzle-orm";

const RESERVATION_TTL_MINUTES = 10;

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
  // Tenta reservar um slot. Retorna null se já está reservado/confirmado por outro lead.
  // A constraint UNIQUE (clinic_id, starts_at) com status pending/confirmed previne concorrência.
  async reserve(
    clinicId: string,
    leadId: string,
    startsAt: Date,
    endsAt: Date,
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

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000);
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
      // INSERT falhou por race condition (outra requisição ganhou)
      return null;
    }
  }

  // Confirma a reserva após criar evento no Google Calendar com sucesso
  async confirm(reservationId: string, calendarEventId: string): Promise<void> {
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
