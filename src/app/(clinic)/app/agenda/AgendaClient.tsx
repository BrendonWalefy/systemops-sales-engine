"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, Ban } from "lucide-react";
import { CalendarView } from "./CalendarView";
import { AppointmentModal } from "./AppointmentModal";
import { BlockModal } from "./BlockModal";
import { AppointmentDrawer } from "./AppointmentDrawer";
import type { AppointmentEvent, Professional } from "./types";

type Props = {
  professionals: Professional[];
  initialFrom: string;
  initialTo: string;
};

export function AgendaClient({ professionals, initialFrom, initialTo }: Props) {
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [appointmentModal, setAppointmentModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
  }>({ open: false });

  const [blockModal, setBlockModal] = useState<{
    open: boolean;
    date?: string;
    time?: string;
  }>({ open: false });

  const [drawer, setDrawer] = useState<{ open: boolean; event?: AppointmentEvent }>({
    open: false,
  });

  const [range, setRange] = useState({ from: initialFrom, to: initialTo });

  const fetchEvents = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appointments?from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(
          (data.appointments ?? []).map((a: Record<string, unknown>) => ({
            ...a,
            startsAt: typeof a.startsAt === "string" ? a.startsAt : new Date(a.startsAt as string).toISOString(),
            endsAt: typeof a.endsAt === "string" ? a.endsAt : new Date(a.endsAt as string).toISOString(),
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEvents(range.from, range.to);
  }, [range, fetchEvents]);

  async function handleEventUpdate(id: string, startsAt: string, endsAt: string) {
    const [date, time] = startsAt.split(" ");
    const [, endTime] = endsAt.split(" ");
    const startDate = new Date(startsAt.replace(" ", "T") + "Z");
    const endDate = new Date(endsAt.replace(" ", "T") + "Z");
    const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000);

    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time: time.slice(0, 5), durationMinutes }),
    });
    fetchEvents(range.from, range.to);
  }

  return (
    <div className="agenda-v2">
      {/* Header */}
      <div className="agenda-v2-header">
        <div>
          <p className="eyebrow">Agenda</p>
          <h1>Agenda da clínica</h1>
        </div>
        <div className="agenda-v2-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setBlockModal({ open: true })}
          >
            <Ban size={14} />
            Bloquear horário
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={() => setAppointmentModal({ open: true })}
          >
            <Plus size={14} />
            Novo agendamento
          </button>
        </div>
      </div>

      {/* Calendar */}
      <div className="agenda-v2-calendar">
        {loading && events.length === 0 ? (
          <div className="calendar-loading">Carregando agenda...</div>
        ) : (
          <CalendarView
            initialEvents={events}
            onSlotClick={(date, time) => setAppointmentModal({ open: true, date, time })}
            onEventClick={(event) => setDrawer({ open: true, event })}
            onEventUpdate={handleEventUpdate}
          />
        )}
      </div>

      {/* Modals */}
      {appointmentModal.open && (
        <AppointmentModal
          defaultDate={appointmentModal.date}
          defaultTime={appointmentModal.time}
          professionals={professionals}
          onClose={() => setAppointmentModal({ open: false })}
          onCreated={() => fetchEvents(range.from, range.to)}
        />
      )}

      {blockModal.open && (
        <BlockModal
          defaultDate={blockModal.date}
          defaultTime={blockModal.time}
          onClose={() => setBlockModal({ open: false })}
          onCreated={() => fetchEvents(range.from, range.to)}
        />
      )}

      {drawer.open && drawer.event && (
        <AppointmentDrawer
          event={drawer.event}
          onClose={() => setDrawer({ open: false })}
          onUpdated={() => fetchEvents(range.from, range.to)}
        />
      )}
    </div>
  );
}
