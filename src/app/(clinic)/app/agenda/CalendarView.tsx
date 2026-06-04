"use client";

import "temporal-polyfill/global";
import { useEffect, useMemo } from "react";
import { useCalendarApp, ScheduleXCalendar } from "@schedule-x/react";
import { createViewWeek, createViewDay, createViewMonthGrid } from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createScrollControllerPlugin } from "@schedule-x/scroll-controller";
import "@schedule-x/theme-default/dist/index.css";
import type { AppointmentEvent } from "./types";

const CALENDAR_TIMEZONE = "America/Sao_Paulo";

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
  onSlotClick?: (date: string, time: string) => void;
  onEventClick?: (event: AppointmentEvent) => void;
  onEventUpdate?: (id: string, startsAt: string, endsAt: string) => void;
};

function toZonedDateTime(iso: string): Temporal.ZonedDateTime {
  try {
    return Temporal.Instant.from(iso).toZonedDateTimeISO(CALENDAR_TIMEZONE);
  } catch {
    const localDateTime = iso.slice(0, 16).replace(" ", "T");
    return Temporal.ZonedDateTime.from(`${localDateTime}:00[${CALENDAR_TIMEZONE}]`);
  }
}

function toDateTimeParts(value: unknown): { date: string; time: string; value: string } | null {
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
    timeZone: CALENDAR_TIMEZONE,
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

function toCalendarEvent(e: AppointmentEvent) {
  return {
    id: e.id,
    title: e.leadName ?? e.leadPhone ?? "Paciente",
    start: toZonedDateTime(e.startsAt),
    end: toZonedDateTime(e.endsAt),
    calendarId: e.status,
    _meta: e,
  };
}

export function CalendarView({ initialEvents, onSlotClick, onEventClick, onEventUpdate }: Props) {
  const eventsService = useMemo(() => createEventsServicePlugin(), []);
  const scrollController = useMemo(() => createScrollControllerPlugin({ initialScroll: "07:00" }), []);

  const calendar = useCalendarApp({
    locale: "pt-BR",
    isDark: true,
    views: [createViewWeek(), createViewDay(), createViewMonthGrid()],
    defaultView: createViewWeek().name,
    plugins: [
      eventsService,
      createDragAndDropPlugin(15),
      scrollController,
    ],
    calendars: CALENDAR_STATUS_COLORS,
    events: initialEvents.map(toCalendarEvent),
    callbacks: {
      onEventClick(event) {
        if (onEventClick && event._meta) {
          onEventClick(event._meta as AppointmentEvent);
        }
      },
      onClickDateTime(dateTime) {
        if (onSlotClick) {
          const parts = toDateTimeParts(dateTime);
          if (parts) onSlotClick(parts.date, parts.time);
        }
      },
      onEventUpdate(updatedEvent) {
        const startsAt = toDateTimeParts(updatedEvent.start);
        const endsAt = toDateTimeParts(updatedEvent.end);
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

  // Sync events when initialEvents changes
  useEffect(() => {
    eventsService.set(initialEvents.map(toCalendarEvent));
  }, [initialEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sx-calendar-wrapper">
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  );
}
