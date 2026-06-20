import { describe, expect, it } from "vitest";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import {
  getStaffReminderWindows,
  isPendingCompletionAppointment,
} from "@/core/scheduling/appointment-reminder-staff";

describe("appointment-reminder-staff helpers", () => {
  it("calcula as janelas locais de hoje e amanhã no fuso da clínica", () => {
    const timezone = new ClinicTimezone("America/Sao_Paulo");
    const now = new Date("2026-06-20T21:00:00Z");

    const { startOfToday, startOfTomorrow, startOfDayAfterTomorrow } =
      getStaffReminderWindows(timezone, now);

    expect(startOfToday.toISOString()).toBe("2026-06-20T03:00:00.000Z");
    expect(startOfTomorrow.toISOString()).toBe("2026-06-21T03:00:00.000Z");
    expect(startOfDayAfterTomorrow.toISOString()).toBe("2026-06-22T03:00:00.000Z");
  });

  it("considera pendente apenas consulta ativa que já terminou", () => {
    const now = new Date("2026-06-20T21:00:00Z");

    expect(
      isPendingCompletionAppointment(
        {
          status: "scheduled",
          endsAt: new Date("2026-06-20T20:30:00Z"),
        },
        now,
      ),
    ).toBe(true);

    expect(
      isPendingCompletionAppointment(
        {
          status: "confirmed",
          endsAt: new Date("2026-06-20T21:30:00Z"),
        },
        now,
      ),
    ).toBe(false);

    expect(
      isPendingCompletionAppointment(
        {
          status: "completed",
          endsAt: new Date("2026-06-20T20:30:00Z"),
        },
        now,
      ),
    ).toBe(false);
  });
});
