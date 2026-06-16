import { describe, expect, it } from "vitest";
import { buildAgendaSnapshotSignature } from "@/app/(clinic)/app/agenda/agenda-snapshot";

describe("buildAgendaSnapshotSignature", () => {
  it("gera a mesma assinatura independente da ordem dos agendamentos", () => {
    const a = buildAgendaSnapshotSignature([
      {
        id: "b",
        startsAt: "2026-06-17T11:00:00.000Z",
        endsAt: "2026-06-17T12:00:00.000Z",
        status: "scheduled",
        professionalId: "prof-2",
        updatedAt: "2026-06-16T12:00:00.000Z",
      },
      {
        id: "a",
        startsAt: "2026-06-17T09:00:00.000Z",
        endsAt: "2026-06-17T10:00:00.000Z",
        status: "confirmed",
        professionalId: null,
        updatedAt: "2026-06-16T11:00:00.000Z",
      },
    ]);

    const b = buildAgendaSnapshotSignature([
      {
        id: "a",
        startsAt: "2026-06-17T09:00:00.000Z",
        endsAt: "2026-06-17T10:00:00.000Z",
        status: "confirmed",
        professionalId: null,
        updatedAt: "2026-06-16T11:00:00.000Z",
      },
      {
        id: "b",
        startsAt: "2026-06-17T11:00:00.000Z",
        endsAt: "2026-06-17T12:00:00.000Z",
        status: "scheduled",
        professionalId: "prof-2",
        updatedAt: "2026-06-16T12:00:00.000Z",
      },
    ]);

    expect(a).toBe(b);
  });

  it("muda a assinatura quando um agendamento é atualizado", () => {
    const base = buildAgendaSnapshotSignature([
      {
        id: "a",
        startsAt: "2026-06-17T09:00:00.000Z",
        endsAt: "2026-06-17T10:00:00.000Z",
        status: "scheduled",
        professionalId: null,
        updatedAt: "2026-06-16T11:00:00.000Z",
      },
    ]);

    const changed = buildAgendaSnapshotSignature([
      {
        id: "a",
        startsAt: "2026-06-17T09:00:00.000Z",
        endsAt: "2026-06-17T10:00:00.000Z",
        status: "cancelled",
        professionalId: null,
        updatedAt: "2026-06-16T11:30:00.000Z",
      },
    ]);

    expect(changed).not.toBe(base);
  });

  it("muda a assinatura quando um novo agendamento é criado", () => {
    const base = buildAgendaSnapshotSignature([]);
    const changed = buildAgendaSnapshotSignature([
      {
        id: "a",
        startsAt: "2026-06-17T09:00:00.000Z",
        endsAt: "2026-06-17T10:00:00.000Z",
        status: "scheduled",
        professionalId: null,
        updatedAt: "2026-06-16T11:00:00.000Z",
      },
    ]);

    expect(changed).not.toBe(base);
  });
});
