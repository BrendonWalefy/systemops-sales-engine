/**
 * Aplica a confirmação de atendimento que o doutor respondeu no WhatsApp.
 *
 * Fecha o bloqueio 2 do item #20: sem consulta em `completed`, a regra de
 * feedback de 24h nunca dispara e o faturamento REALIZADO do painel fica em
 * R$ 0 (a home soma `valueCents` de `status = completed`).
 *
 * Escopo deliberado: só mexe em consultas de HOJE que já terminaram e seguem
 * `scheduled`/`confirmed` — as mesmas que a mensagem listou. Um código de
 * horário nunca alcança outro dia, então uma resposta atrasada não reescreve
 * histórico.
 */

import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments, leads } from "@/infrastructure/db/schema";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { getStaffReminderWindows, isPendingCompletionAppointment } from "@/core/scheduling/appointment-reminder-staff";
import type { AppointmentCompletionAction } from "./appointment-completion-review";
import { toTimeCode } from "./appointment-completion-review";

export type PendingTodayAppointment = {
  id: string;
  leadId: string;
  startsAt: Date;
  timeCode: string;
  leadName: string;
};

export async function listPendingTodayAppointments(params: {
  clinicId: string;
  timezone: string;
  now?: Date;
}): Promise<PendingTodayAppointment[]> {
  const now = params.now ?? new Date();
  const tz = new ClinicTimezone(params.timezone);
  const { startOfToday, startOfTomorrow } = getStaffReminderWindows(tz, now);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: params.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const rows = await db
    .select({
      id: appointments.id,
      leadId: appointments.leadId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(appointments)
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        eq(appointments.clinicId, params.clinicId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        gte(appointments.startsAt, startOfToday),
        lt(appointments.startsAt, startOfTomorrow),
      ),
    )
    .orderBy(appointments.startsAt);

  return rows
    .filter((r) => isPendingCompletionAppointment(r, now))
    .map((r) => ({
      id: r.id,
      leadId: r.leadId,
      startsAt: r.startsAt,
      timeCode: toTimeCode(fmt.format(r.startsAt)),
      leadName: r.leadName ?? r.leadPhone ?? "Paciente",
    }));
}

export type CompletionOutcome =
  | { ok: true; updated: PendingTodayAppointment[]; action: AppointmentCompletionAction }
  | { ok: false; reason: "not_found" };

export async function applyAppointmentCompletion(params: {
  clinicId: string;
  timezone: string;
  /** `all` conclui todos os pendentes de hoje; um timeCode atinge só aquele. */
  target: { kind: "all" } | { kind: "single"; timeCode: string };
  action: AppointmentCompletionAction;
  now?: Date;
}): Promise<CompletionOutcome> {
  const pending = await listPendingTodayAppointments({
    clinicId: params.clinicId,
    timezone: params.timezone,
    now: params.now,
  });

  const alvos = params.target.kind === "all"
    ? pending
    : pending.filter((a) => a.timeCode === (params.target as { timeCode: string }).timeCode);

  if (alvos.length === 0) return { ok: false, reason: "not_found" };

  await db
    .update(appointments)
    .set({ status: params.action, updatedAt: new Date() })
    .where(
      and(
        eq(appointments.clinicId, params.clinicId),
        inArray(appointments.id, alvos.map((a) => a.id)),
        // Corrida com o painel: se alguém já concluiu por lá, não sobrescreve.
        inArray(appointments.status, ["scheduled", "confirmed"]),
      ),
    );

  return { ok: true, updated: alvos, action: params.action };
}

export function buildCompletionConfirmationMessage(outcome: {
  updated: PendingTodayAppointment[];
  action: AppointmentCompletionAction;
}): string {
  const nomes = outcome.updated.map((a) => a.leadName).join(", ");
  if (outcome.action === "no_show") return `Anotado: ${nomes} não compareceu.`;
  return outcome.updated.length === 1
    ? `Pronto! ${nomes} marcada como atendida.`
    : `Pronto! ${outcome.updated.length} atendimentos confirmados: ${nomes}.`;
}

export function buildCompletionNotFoundMessage(timeCode: string): string {
  const hora = `${timeCode.slice(0, 2)}:${timeCode.slice(2)}`;
  return `Não encontrei consulta pendente às ${hora} hoje. Pode já ter sido confirmada no painel.`;
}
