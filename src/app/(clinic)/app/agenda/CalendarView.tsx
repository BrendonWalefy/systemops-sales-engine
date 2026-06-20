"use client";

import "temporal-polyfill/global";
import { useCallback, useEffect, useMemo } from "react";
import { useCalendarApp, ScheduleXCalendar } from "@schedule-x/react";
import { createViewWeek, createViewDay, createViewMonthGrid } from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import "@schedule-x/theme-default/dist/index.css";
import type { AppointmentEvent } from "./types";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const FULL_DAY_BLOCK_MINUTES = 12 * 60;

const CALENDAR_STATUS_COLORS = {
  scheduled: {
    colorName: "scheduled",
    lightColors: { main: "#60a5fa", container: "rgba(37,99,235,0.42)", onContainer: "#eff6ff" },
    darkColors: { main: "#60a5fa", container: "rgba(37,99,235,0.42)", onContainer: "#eff6ff" },
  },
  confirmed: {
    colorName: "confirmed",
    lightColors: { main: "#00d4aa", container: "rgba(0,212,170,0.28)", onContainer: "#ecfffb" },
    darkColors: { main: "#00d4aa", container: "rgba(0,212,170,0.28)", onContainer: "#ecfffb" },
  },
  completed: {
    colorName: "completed",
    lightColors: { main: "#22c55e", container: "rgba(34,197,94,0.24)", onContainer: "#f0fdf4" },
    darkColors: { main: "#22c55e", container: "rgba(34,197,94,0.24)", onContainer: "#f0fdf4" },
  },
  cancelled: {
    colorName: "cancelled",
    lightColors: { main: "#64748b", container: "rgba(100,116,139,0.24)", onContainer: "#f8fafc" },
    darkColors: { main: "#64748b", container: "rgba(100,116,139,0.24)", onContainer: "#f8fafc" },
  },
  no_show: {
    colorName: "no_show",
    lightColors: { main: "#fb7185", container: "rgba(251,113,133,0.24)", onContainer: "#fff1f2" },
    darkColors: { main: "#fb7185", container: "rgba(251,113,133,0.24)", onContainer: "#fff1f2" },
  },
  block: {
    colorName: "block",
    lightColors: { main: "#f5b451", container: "rgba(245,180,81,0.24)", onContainer: "#fffbeb" },
    darkColors: { main: "#f5b451", container: "rgba(245,180,81,0.24)", onContainer: "#fffbeb" },
  },
} as const;

type Props = {
  initialEvents: AppointmentEvent[];
  currentView?: string;
  timezone?: string;
  onSlotClick?: (date: string, time: string) => void;
  onEventClick?: (event: AppointmentEvent) => void;
  onEventUpdate?: (id: string, startsAt: string, endsAt: string) => void;
};

function toZonedDateTime(iso: string, timezone: string): Temporal.ZonedDateTime {
  try {
    return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone);
  } catch {
    const localDateTime = iso.slice(0, 16).replace(" ", "T");
    return Temporal.ZonedDateTime.from(`${localDateTime}:00[${timezone}]`);
  }
}

function toDateTimeParts(value: unknown, timezone: string): { date: string; time: string; value: string } | null {
  let raw: string;

  if (typeof value === "string") {
    raw = value;
  } else if (value instanceof Date) {
    raw = value.toISOString();
  } else if (value && typeof (value as { toString?: unknown }).toString === "function") {
    raw = (value as { toString: () => string }).toString();
  } else {
    return null;
  }

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (match) {
    const [, date, time] = match;
    return { date, time, value: `${date} ${time}` };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const date = `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
  const time = `${byType.get("hour")}:${byType.get("minute")}`;
  return { date, time, value: `${date} ${time}` };
}

export function CalendarView({ initialEvents, currentView, timezone = DEFAULT_TIMEZONE, onSlotClick, onEventClick, onEventUpdate }: Props) {
  const eventsService = useMemo(() => createEventsServicePlugin(), []);
  const backgroundEvents = useMemo(
    () =>
      initialEvents
        .filter((event) => {
          if (event.status !== "block") return false;
          const startsAt = new Date(event.startsAt);
          const endsAt = new Date(event.endsAt);
          return (endsAt.getTime() - startsAt.getTime()) / 60_000 >= FULL_DAY_BLOCK_MINUTES;
        })
        .map((event) => {
          const zonedStart = toZonedDateTime(event.startsAt, timezone);
          const zonedEnd = toZonedDateTime(event.endsAt, timezone);
          const startDate = Temporal.PlainDate.from(zonedStart.toPlainDate().toString());
          const endDate = Temporal.PlainDate.from(zonedEnd.toPlainDate().toString());

          return {
            start: startDate,
            end: endDate,
            title: event.leadName ?? "Agenda bloqueada",
            style: {
              background:
                "linear-gradient(180deg, rgba(245,180,81,0.18), rgba(245,180,81,0.08))",
              border: "1px solid rgba(245,180,81,0.16)",
            },
          };
        }),
    [initialEvents, timezone],
  );

  const toCalendarEvent = useCallback((e: AppointmentEvent) => {
    const isBlock = e.status === "block";
    const leadLabel = e.leadName ?? e.leadPhone ?? "Paciente";

    let title: string;
    if (isBlock) {
      title = `🚫 ${e.leadName || "Bloqueado"}`;
    } else {
      const parts = [leadLabel];
      if (e.leadTreatmentInterest) parts.push(e.leadTreatmentInterest);
      if (e.professionalName) parts.push(e.professionalName);
      title = parts.join(" · ");
    }

    return {
      id: e.id,
      title,
      start: toZonedDateTime(e.startsAt, timezone),
      end: toZonedDateTime(e.endsAt, timezone),
      calendarId: e.status,
      _meta: e,
      ...(isBlock && { options: { disableDND: true, disableResize: true } }),
    };
  }, [timezone]);

  const calendar = useCalendarApp({
    locale: "pt-BR",
    isDark: true,
    isResponsive: false,
    timezone,
    dayBoundaries: { start: "07:00", end: "21:00" },
    views: [createViewWeek(), createViewDay(), createViewMonthGrid()],
    defaultView: currentView ?? createViewMonthGrid().name,
    plugins: [
      eventsService,
      createDragAndDropPlugin(15),
    ],
    calendars: CALENDAR_STATUS_COLORS,
    events: initialEvents.map(toCalendarEvent),
    backgroundEvents,
    callbacks: {
      onEventClick(event) {
        if (onEventClick && event._meta) {
          onEventClick(event._meta as AppointmentEvent);
        }
      },
      onClickDateTime(dateTime) {
        if (onSlotClick) {
          const parts = toDateTimeParts(dateTime, timezone);
          if (!parts) return;
          // Não abre modal para datas passadas
          if (parts.date < Temporal.Now.plainDateISO().toString()) return;
          onSlotClick(parts.date, parts.time);
        }
      },
      onEventUpdate(updatedEvent) {
        const startsAt = toDateTimeParts(updatedEvent.start, timezone);
        const endsAt = toDateTimeParts(updatedEvent.end, timezone);
        if (!startsAt || !endsAt) return;

        if (onEventUpdate) {
          onEventUpdate(
            String(updatedEvent.id),
            startsAt.value,
            endsAt.value,
          );
        }
      },
    },
  });

  // Switch view imperatively — avoids remount and overrides any persisted state
  useEffect(() => {
    if (!calendar || !currentView) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $app = (calendar as any)?.$app;
    $app?.calendarState?.setView?.(currentView, Temporal.Now.plainDateISO());
  }, [calendar, currentView]);

  // Scroll horizontally to center today's column + vertically to current time
  useEffect(() => {
    if (!calendar) return;
    const timer = setTimeout(() => {
      // Horizontal: center today's column
      const todayHeader = document.querySelector(
        ".sx__week-grid__date--is-today",
      ) as HTMLElement | null;
      todayHeader?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });

      // Vertical: scroll to current time indicator (or 9 AM if not visible)
      const indicator = document.querySelector(".sx__current-time-indicator") as HTMLElement | null;
      if (indicator) {
        indicator.scrollIntoView({ behavior: "instant", block: "center" });
      } else {
        // No indicator (other day/month view): scroll to 9 AM equivalent
        const viewScroll = document.querySelector(".sx__view-container") as HTMLElement | null;
        if (viewScroll) {
          const slotEl = document.querySelector(".sx__time-grid-slot") as HTMLElement | null;
          const slotHeight = slotEl?.offsetHeight ?? 48;
          viewScroll.scrollTop = slotHeight * 2; // ~2 hours from start (07:00 → 09:00)
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [calendar, currentView]);

  // Sync events when initialEvents changes
  useEffect(() => {
    eventsService.set(initialEvents.map(toCalendarEvent));
  }, [initialEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Schedule-X does not expose a background-events service plugin.
    // Updating the internal signal keeps month/day highlights in sync after refreshes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $app = (calendar as any)?.$app;
    if ($app?.calendarEvents?.backgroundEvents) {
      // eslint-disable-next-line react-hooks/immutability
      $app.calendarEvents.backgroundEvents.value = backgroundEvents;
    }
  }, [calendar, backgroundEvents]);

  return (
    <div className="sx-calendar-wrapper">
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  );
}
