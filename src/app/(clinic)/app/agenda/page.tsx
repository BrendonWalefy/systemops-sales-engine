export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { Bot, CalendarCheck2, Clock3, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { BlockForm } from "./BlockForm";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, leads } from "@/infrastructure/db/schema";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { BlockEvent } from "@/application/ports/calendar-gateway";
import { deleteBlock } from "./actions";

const TZ = "America/Sao_Paulo";

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type BlockDisplay = {
  dateLabel: string;
  timeLabel: string;
  reasonLabel: string;
  isFullDay: boolean;
};

type UpcomingAppointment = {
  id: string;
  leadName: string | null;
  leadPhone: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const appointmentDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

function getLocalParts(date: Date): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function isNextLocalDay(start: LocalDateParts, end: LocalDateParts): boolean {
  const next = new Date(Date.UTC(start.year, start.month - 1, start.day + 1));
  return (
    end.year === next.getUTCFullYear()
    && end.month === next.getUTCMonth() + 1
    && end.day === next.getUTCDate()
  );
}

function isFullDayBlock(block: BlockEvent): boolean {
  const start = getLocalParts(block.startsAt);
  const end = getLocalParts(block.endsAt);
  const startsAtMidnight = start.hour === 0 && start.minute === 0;
  const endsAtNextMidnight = end.hour === 0 && end.minute === 0 && isNextLocalDay(start, end);
  const endsAtLegacyFullDay = end.year === start.year
    && end.month === start.month
    && end.day === start.day
    && end.hour === 23
    && end.minute >= 59;

  return startsAtMidnight && (endsAtNextMidnight || endsAtLegacyFullDay);
}

function getBlockDisplay(block: BlockEvent): BlockDisplay {
  const fullDay = isFullDayBlock(block);
  const dateLabel = dateFormatter.format(block.startsAt).replace(".", "");
  const timeLabel = fullDay
    ? "Dia inteiro"
    : `${timeFormatter.format(block.startsAt)} - ${timeFormatter.format(block.endsAt)}`;

  return {
    dateLabel,
    timeLabel,
    reasonLabel: block.reason || "Sem motivo informado",
    isFullDay: fullDay,
  };
}

function getNextBlockLabel(blocks: BlockEvent[]): string {
  if (blocks.length === 0) return "Nenhum bloqueio ativo";

  const display = getBlockDisplay(blocks[0]);
  return `${display.dateLabel} - ${display.timeLabel}`;
}

function appointmentStatusLabel(status: string): string {
  if (status === "confirmed") return "Confirmado";
  return "Agendado";
}

function appointmentDateLabel(date: Date): string {
  return appointmentDateFormatter.format(date).replace(".", "");
}

async function getBlocks(): Promise<BlockEvent[]> {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return [];

  const [clinic] = await db
    .select({ googleCalendarId: clinics.googleCalendarId, timezone: clinics.timezone, businessHours: clinics.businessHours })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinic) return [];

  const gateway = new GoogleCalendarGateway(
    clinic.googleCalendarId,
    new ClinicTimezone(clinic.timezone),
    clinic.businessHours,
  );

  const from = new Date();
  const to = new Date(Date.now() + 60 * 24 * 60 * 60_000);

  return gateway.listBlockEvents({ clinicId, from, to });
}

async function getUpcomingAppointments(): Promise<UpcomingAppointment[]> {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return [];

  return db
    .select({
      id: appointments.id,
      leadName: leads.name,
      leadPhone: leads.phone,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
    })
    .from(appointments)
    .innerJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        gte(appointments.startsAt, new Date()),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(8);
}

export default async function AgendaPage() {
  const [blocks, upcomingAppointments] = await Promise.all([
    getBlocks(),
    getUpcomingAppointments(),
  ]);
  const fullDayBlocks = blocks.filter(isFullDayBlock).length;
  const nextBlockLabel = getNextBlockLabel(blocks);

  return (
    <div className="agenda-page">
      <div className="product-topbar agenda-topbar">
        <div className="agenda-title">
          <p className="eyebrow">Agenda</p>
          <h1>Agenda da clínica</h1>
          <p className="agenda-subtitle">
            Acompanhe consultas futuras e indisponibilidades usadas pela IA.
          </p>
        </div>

        <div className="agenda-sync-pill" aria-label="Sincronizado com a IA">
          <span className="live-dot" />
          <span>Sincronizado com IA</span>
        </div>
      </div>

      <div className="agenda-content">
        <section className="agenda-panel agenda-appointments-panel" aria-label="Próximas consultas">
          <div className="agenda-panel-header agenda-appointments-header">
            <span className="agenda-panel-icon">
              <CalendarCheck2 size={18} strokeWidth={1.9} />
            </span>
            <div>
              <h2>Próximas consultas</h2>
              <p>
                {upcomingAppointments.length === 0
                  ? "Nenhuma consulta futura registrada."
                  : `Mostrando ${upcomingAppointments.length === 1 ? "a próxima consulta" : `as próximas ${upcomingAppointments.length} consultas`} na agenda.`}
              </p>
            </div>
          </div>

          {upcomingAppointments.length === 0 ? (
            <div className="agenda-empty-state agenda-empty-compact">
              <CalendarCheck2 size={24} strokeWidth={1.8} />
              <strong>Nenhuma consulta futura</strong>
              <p>Quando a IA ou a equipe agendar um paciente, ele aparece aqui.</p>
            </div>
          ) : (
            <div className="agenda-appointment-list">
              {upcomingAppointments.map((appointment) => {
                const displayName = appointment.leadName ?? appointment.leadPhone ?? "Paciente";
                return (
                  <article key={appointment.id} className="agenda-appointment-card">
                    <div className="agenda-appointment-time">
                      <strong>{appointmentDateLabel(appointment.startsAt)}</strong>
                      <span>{timeFormatter.format(appointment.startsAt)} - {timeFormatter.format(appointment.endsAt)}</span>
                    </div>
                    <div className="agenda-appointment-main">
                      <strong>{displayName}</strong>
                      <span>{appointment.leadPhone ?? "Telefone não informado"}</span>
                    </div>
                    <span className="agenda-appointment-status">
                      {appointmentStatusLabel(appointment.status)}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="agenda-summary" aria-label="Resumo de bloqueios">
          <div className="agenda-summary-item">
            <span className="agenda-summary-icon accent">
              <ShieldCheck size={17} strokeWidth={2} />
            </span>
            <div>
              <strong>{blocks.length}</strong>
              <span>bloqueios ativos</span>
            </div>
          </div>

          <div className="agenda-summary-item">
            <span className="agenda-summary-icon warm">
              <CalendarCheck2 size={17} strokeWidth={2} />
            </span>
            <div>
              <strong>{fullDayBlocks}</strong>
              <span>dias inteiros</span>
            </div>
          </div>

          <div className="agenda-summary-item wide">
            <span className="agenda-summary-icon cold">
              <Clock3 size={17} strokeWidth={2} />
            </span>
            <div>
              <strong>{blocks.length === 0 ? "Agenda livre" : nextBlockLabel}</strong>
              <span>{blocks.length === 0 ? "nenhum bloqueio nos próximos 60 dias" : "próximo bloqueio"}</span>
            </div>
          </div>
        </section>

        <div className="agenda-grid">
          <section className="agenda-panel agenda-form-panel">
            <div className="agenda-panel-header">
              <span className="agenda-panel-icon">
                <Plus size={18} strokeWidth={1.9} />
              </span>
              <div>
                <h2>Novo bloqueio</h2>
                <p>Trave um horário, um dia completo ou uma sequência de dias.</p>
              </div>
            </div>

            <BlockForm />
          </section>

          <section className="agenda-panel agenda-list-panel">
            <div className="agenda-panel-header">
              <span className="agenda-panel-icon">
                <Bot size={18} strokeWidth={1.9} />
              </span>
              <div>
                <h2>Bloqueios ativos</h2>
                <p>Próximos 60 dias monitorados pela IA.</p>
              </div>
            </div>

            {blocks.length === 0 ? (
              <div className="agenda-empty-state">
                <CalendarCheck2 size={24} strokeWidth={1.8} />
                <strong>Nenhum bloqueio cadastrado</strong>
                <p>Quando houver folgas, feriados ou atendimentos externos, eles aparecem aqui.</p>
              </div>
            ) : (
              <div className="agenda-block-list">
                {blocks.map((block) => {
                  const display = getBlockDisplay(block);

                  return (
                    <article
                      key={block.calendarEventId}
                      className={`agenda-block-card${display.isFullDay ? " full-day" : ""}`}
                    >
                      <span className="agenda-block-marker" aria-hidden="true" />

                      <div className="agenda-block-main">
                        <div className="agenda-block-row">
                          <strong>{display.dateLabel}</strong>
                          <span>{display.timeLabel}</span>
                        </div>
                        <p>{display.reasonLabel}</p>
                      </div>

                      <form action={deleteBlock.bind(null, block.calendarEventId)}>
                        <button
                          type="submit"
                          className="agenda-delete-btn"
                          title="Remover bloqueio"
                          aria-label="Remover bloqueio"
                        >
                          <Trash2 size={15} strokeWidth={1.9} />
                        </button>
                      </form>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
