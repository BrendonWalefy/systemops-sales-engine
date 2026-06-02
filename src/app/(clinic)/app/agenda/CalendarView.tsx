"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useCalendarApp, ScheduleXCalendar } from "@schedule-x/react";
import { createViewWeek, createViewDay, createViewMonthGrid } from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createScrollControllerPlugin } from "@schedule-x/scroll-controller";
import "@schedule-x/theme-default/dist/index.css";
import type { AppointmentEvent } from "./types";

type Props = {
  initialEvents: AppointmentEvent[];
  onSlotClick?: (date: string, time: string) => void;
  onEventClick?: (event: AppointmentEvent) => void;
  onEventUpdate?: (id: string, startsAt: string, endsAt: string) => void;
};

function statusColor(status: string): string {
  switch (status) {
    case "confirmed": return "#10b981";
    case "completed": return "#34d399";
    case "cancelled": return "#71717a";
    case "no_show": return "#ef4444";
    default: return "#3b82f6"; // scheduled
  }
}

function toCalendarEvent(e: AppointmentEvent) {
  return {
    id: e.id,
    title: e.leadName ?? e.leadPhone ?? "Paciente",
    start: e.startsAt.slice(0, 16).replace("T", " "),
    end: e.endsAt.slice(0, 16).replace("T", " "),
    calendarId: e.status,
    _meta: e,
  };
}

export function CalendarView({ initialEvents, onSlotClick, onEventClick, onEventUpdate }: Props) {
  const eventsService = createEventsServicePlugin();
  const scrollController = createScrollControllerPlugin({ initialScroll: "07:00" });

  const calendar = useCalendarApp({
    locale: "pt-BR",
    views: [createViewWeek(), createViewDay(), createViewMonthGrid()],
    defaultView: createViewWeek().name,
    plugins: [
      eventsService,
      createDragAndDropPlugin(15),
      scrollController,
    ],
    calendars: {
      scheduled: { colorName: "scheduled", lightColors: { main: "#3b82f6", container: "rgba(59,130,246,0.15)", onContainer: "#93c5fd" }, darkColors: { main: "#3b82f6", container: "rgba(59,130,246,0.15)", onContainer: "#93c5fd" } },
      confirmed: { colorName: "confirmed", lightColors: { main: "#10b981", container: "rgba(16,185,129,0.15)", onContainer: "#6ee7b7" }, darkColors: { main: "#10b981", container: "rgba(16,185,129,0.15)", onContainer: "#6ee7b7" } },
      completed: { colorName: "completed", lightColors: { main: "#34d399", container: "rgba(52,211,153,0.12)", onContainer: "#a7f3d0" }, darkColors: { main: "#34d399", container: "rgba(52,211,153,0.12)", onContainer: "#a7f3d0" } },
      cancelled: { colorName: "cancelled", lightColors: { main: "#52525b", container: "rgba(82,82,91,0.12)", onContainer: "#a1a1aa" }, darkColors: { main: "#52525b", container: "rgba(82,82,91,0.12)", onContainer: "#a1a1aa" } },
      no_show: { colorName: "no_show", lightColors: { main: "#ef4444", container: "rgba(239,68,68,0.12)", onContainer: "#fca5a5" }, darkColors: { main: "#ef4444", container: "rgba(239,68,68,0.12)", onContainer: "#fca5a5" } },
      block: { colorName: "block", lightColors: { main: "#3f3f46", container: "rgba(63,63,70,0.4)", onContainer: "#71717a" }, darkColors: { main: "#3f3f46", container: "rgba(63,63,70,0.4)", onContainer: "#71717a" } },
    },
    events: initialEvents.map(toCalendarEvent),
    callbacks: {
      onEventClick(event) {
        if (onEventClick && event._meta) {
          onEventClick(event._meta as AppointmentEvent);
        }
      },
      onClickDateTime(dateTime) {
        if (onSlotClick) {
          const [date, time] = dateTime.includes("T")
            ? dateTime.split("T")
            : dateTime.split(" ");
          onSlotClick(date, time?.slice(0, 5) ?? "09:00");
        }
      },
      onEventUpdate(updatedEvent) {
        if (onEventUpdate) {
          onEventUpdate(
            String(updatedEvent.id),
            updatedEvent.start,
            updatedEvent.end,
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
