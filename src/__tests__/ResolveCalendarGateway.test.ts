// Testes do resolver: derivação do modo e seleção do gateway correto.
// Construir os gateways NÃO toca o banco (db é Proxy lazy), então é seguro.

import { describe, expect, it } from "vitest";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import {
  resolveCalendarMode,
  resolveCalendarGateway,
} from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { InternalCalendarGateway } from "@/infrastructure/adapters/calendar/internal/internal-calendar-gateway";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";

const tz = new ClinicTimezone("America/Sao_Paulo");

describe("resolveCalendarMode", () => {
  it("respeita o modo explícito 'internal'", () => {
    expect(resolveCalendarMode({ calendarMode: "internal", googleCalendarId: "cal@x" })).toBe("internal");
  });

  it("respeita o modo explícito 'google_calendar'", () => {
    expect(resolveCalendarMode({ calendarMode: "google_calendar", googleCalendarId: null })).toBe("google_calendar");
  });

  it("null + googleCalendarId presente → google_calendar (preserva legado)", () => {
    expect(resolveCalendarMode({ calendarMode: null, googleCalendarId: "cal@x" })).toBe("google_calendar");
  });

  it("null + sem googleCalendarId → internal", () => {
    expect(resolveCalendarMode({ calendarMode: null, googleCalendarId: null })).toBe("internal");
  });
});

describe("resolveCalendarGateway", () => {
  it("modo internal devolve InternalCalendarGateway", () => {
    const g = resolveCalendarGateway({
      clinicId: "c1",
      calendarMode: "internal",
      googleCalendarId: null,
      timezone: tz,
      businessHours: null,
    });
    expect(g).toBeInstanceOf(InternalCalendarGateway);
  });

  it("modo google_calendar devolve GoogleCalendarGateway", () => {
    const g = resolveCalendarGateway({
      clinicId: "c1",
      calendarMode: "google_calendar",
      googleCalendarId: "cal@x",
      timezone: tz,
      businessHours: null,
    });
    expect(g).toBeInstanceOf(GoogleCalendarGateway);
  });

  it("Horizonte (calendarMode 'internal') usa o interno mesmo com googleCalendarId setado", () => {
    const g = resolveCalendarGateway({
      clinicId: "horizonte",
      calendarMode: "internal",
      googleCalendarId: "horizonte@group.calendar.google.com",
      timezone: tz,
      businessHours: null,
    });
    expect(g).toBeInstanceOf(InternalCalendarGateway);
  });

  it("clínica nova sem config (null/null) cai no interno por padrão", () => {
    const g = resolveCalendarGateway({
      clinicId: "nova",
      calendarMode: null,
      googleCalendarId: null,
      timezone: tz,
      businessHours: null,
    });
    expect(g).toBeInstanceOf(InternalCalendarGateway);
  });
});
