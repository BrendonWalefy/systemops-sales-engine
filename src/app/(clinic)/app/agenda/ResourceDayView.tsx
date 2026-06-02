"use client";

import { useRef, useEffect, useState } from "react";
import type { AppointmentEvent, Professional } from "./types";

const HOUR_HEIGHT = 64;
const START_HOUR = 7;
const END_HOUR = 20;
const COL_MIN = 220;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const STATUS_BG: Record<string, string> = {
  scheduled: "rgba(59,130,246,0.14)",
  confirmed: "rgba(16,185,129,0.14)",
  completed: "rgba(52,211,153,0.10)",
  cancelled: "rgba(82,82,91,0.12)",
  no_show: "rgba(239,68,68,0.10)",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "No-show",
};

function toSpTimeParts(iso: string): { h: number; m: number } {
  const str = new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = str.split(":").map(Number);
  return { h, m };
}

function toSpDateStr(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function eventTop(startsAt: string): number {
  const { h, m } = toSpTimeParts(startsAt);
  return Math.max(0, (h - START_HOUR + m / 60) * HOUR_HEIGHT);
}

function eventHeight(startsAt: string, endsAt: string): number {
  const s = toSpTimeParts(startsAt);
  const e = toSpTimeParts(endsAt);
  const dur = (e.h - s.h) * 60 + (e.m - s.m);
  return Math.max(28, (dur / 60) * HOUR_HEIGHT);
}

function currentNowY(): number | null {
  const now = new Date();
  const { h, m } = toSpTimeParts(now.toISOString());
  if (h < START_HOUR || h >= END_HOUR) return null;
  return (h - START_HOUR + m / 60) * HOUR_HEIGHT;
}

type Col = { id: string | null; name: string; color: string; specialty: string | null };

type Props = {
  professionals: Professional[];
  events: AppointmentEvent[];
  selectedDate: Date;
  onSlotClick: (date: string, time: string, professionalId?: string) => void;
  onEventClick: (event: AppointmentEvent) => void;
};

export function ResourceDayView({ professionals, events, selectedDate, onSlotClick, onEventClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const headerColsRef = useRef<HTMLDivElement>(null);
  const [nowY, setNowY] = useState<number | null>(currentNowY);
  const todayStr = toSpDateStr(new Date());
  const selectedStr = toSpDateStr(selectedDate);

  // Keep "now" indicator updated
  useEffect(() => {
    const tick = () => setNowY(currentNowY());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync scroll positions
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    if (headerColsRef.current) headerColsRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  const columns: Col[] = [
    ...professionals.filter((p) => p.isActive !== false).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      specialty: p.specialty,
    })),
    { id: null, name: "Sem profissional", color: "#52525b", specialty: null },
  ];

  // Filter day events (exclude cancelled for visual clarity)
  const dayEvents = events.filter((e) => {
    if (e.status === "cancelled") return false;
    return toSpDateStr(new Date(e.startsAt)) === selectedStr;
  });

  // Distribute events per column
  const byCol = new Map<string | null, AppointmentEvent[]>();
  for (const col of columns) byCol.set(col.id, []);
  for (const ev of dayEvents) {
    const key = ev.professionalId;
    if (key && byCol.has(key)) {
      byCol.get(key)!.push(ev);
    } else {
      byCol.get(null)!.push(ev);
    }
  }

  function handleColClick(e: React.MouseEvent<HTMLDivElement>, colId: string | null) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top + (e.currentTarget.parentElement?.scrollTop ?? 0);
    const totalMinutes = (relY / HOUR_HEIGHT) * 60 + START_HOUR * 60;
    const h = Math.floor(totalMinutes / 60);
    const rawM = Math.round((totalMinutes % 60) / 15) * 15;
    const m = rawM >= 60 ? 0 : rawM;
    const safeH = Math.min(Math.max(h, START_HOUR), END_HOUR - 1);
    const time = `${String(safeH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const dateStr = selectedDate.toLocaleDateString("en-CA"); // YYYY-MM-DD local
    onSlotClick(dateStr, time, colId ?? undefined);
  }

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  return (
    <div className="rdv-wrapper">
      {/* Sticky top: corner + col headers */}
      <div className="rdv-top">
        <div className="rdv-corner" />
        <div className="rdv-col-headers" ref={headerColsRef}>
          {columns.map((col) => (
            <div key={col.id ?? "__none__"} className="rdv-col-header">
              <div className="rdv-col-header-inner">
                <span className="rdv-col-dot" style={{ background: col.color }} />
                <div>
                  <span className="rdv-col-name">{col.name}</span>
                  {col.specialty && <span className="rdv-col-specialty">{col.specialty}</span>}
                </div>
              </div>
              <span className="rdv-col-count">
                {(byCol.get(col.id) ?? []).length} agendamento{(byCol.get(col.id) ?? []).length !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Body: gutter (left) + scrollable columns */}
      <div className="rdv-body-row">
        {/* Time gutter — scroll synced via JS */}
        <div className="rdv-gutter" ref={gutterRef}>
          <div style={{ position: "relative", height: totalHeight }}>
            {HOURS.map((h) => (
              <div key={h} className="rdv-time-label" style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
        </div>

        {/* Main scroll area */}
        <div className="rdv-scroll" ref={scrollRef} onScroll={onScroll}>
          <div
            className="rdv-cols-body"
            style={{ height: totalHeight, minWidth: columns.length * COL_MIN }}
          >
            {/* Hour lines */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="rdv-hour-line"
                style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}
              />
            ))}
            {/* 30-min half-lines */}
            {HOURS.map((h) => (
              <div
                key={`${h}-half`}
                className="rdv-half-hour-line"
                style={{ top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
              />
            ))}

            {/* "Agora" indicator */}
            {nowY !== null && selectedStr === todayStr && (
              <div className="rdv-now-indicator" style={{ top: nowY }}>
                <div className="rdv-now-dot" />
                <div className="rdv-now-line-h" />
              </div>
            )}

            {/* Professional columns */}
            {columns.map((col, idx) => {
              const colEvents = byCol.get(col.id) ?? [];
              return (
                <div
                  key={col.id ?? "__none__"}
                  className="rdv-col"
                  style={{
                    left: idx * COL_MIN,
                    width: COL_MIN,
                  }}
                  onClick={(e) => handleColClick(e, col.id)}
                >
                  {colEvents.map((ev) => {
                    const top = eventTop(ev.startsAt);
                    const height = eventHeight(ev.startsAt, ev.endsAt);
                    const { h: sh, m: sm } = toSpTimeParts(ev.startsAt);
                    const { h: eh, m: em } = toSpTimeParts(ev.endsAt);
                    const timeStr = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}–${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
                    const borderColor = col.id ? col.color : (ev.professionalColor ?? "#52525b");

                    return (
                      <div
                        key={ev.id}
                        className="rdv-event"
                        style={{
                          top,
                          height,
                          borderLeftColor: borderColor,
                          background: STATUS_BG[ev.status] ?? STATUS_BG.scheduled,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev);
                        }}
                      >
                        <span className="rdv-event-name">
                          {ev.leadName ?? ev.leadPhone ?? "Paciente"}
                        </span>
                        <span className="rdv-event-time">{timeStr}</span>
                        {height > 52 && (
                          <span className="rdv-event-status">
                            {STATUS_LABELS[ev.status]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Column separators */}
            {columns.map((col, idx) => (
              <div
                key={`sep-${col.id ?? "__none__"}`}
                className="rdv-col-sep"
                style={{ left: (idx + 1) * COL_MIN }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
