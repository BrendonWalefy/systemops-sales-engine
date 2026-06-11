// Tests for inbox filter logic — pure functions, no DOM needed.

import { describe, it, expect } from "vitest";
import { filterBySearch, filterLiveRowsByTab, resolveEmConversa, sortInboxRowsByRecency } from "@/app/(clinic)/app/inbox/inbox-filter";
import type { ConvRow } from "@/app/(clinic)/app/inbox/InboxClient";

function row(overrides: Partial<ConvRow> & { convId: string }): ConvRow {
  return {
    leadId: "lead-1",
    lastMessageAt: new Date(),
    lastReadAt: null,
    needsAttention: false,
    attentionReason: null,
    aiPaused: false,
    leadName: "Lead",
    leadPhone: "5511999999999",
    leadStatus: "new",
    leadTemperature: "warm",
    leadTreatmentInterest: null,
    leadProfilePicUrl: null,
    ...overrides,
  };
}

const handoff = row({ convId: "h1", leadName: "Handoff", aiPaused: true, needsAttention: true });
const active = row({ convId: "a1", leadName: "Ativo" });
const scheduled = row({ convId: "s1", leadName: "Agendado", leadStatus: "appointment_scheduled" });

describe("filterBySearch", () => {
  it("retorna todos os rows quando busca está vazia", () => {
    expect(filterBySearch([handoff, active], "")).toHaveLength(2);
  });

  it("filtra por nome (case-insensitive)", () => {
    const result = filterBySearch([handoff, active], "ativo");
    expect(result).toHaveLength(1);
    expect(result[0].convId).toBe("a1");
  });

  it("filtra por telefone", () => {
    const r = row({ convId: "x1", leadName: null, leadPhone: "5511888888888" });
    expect(filterBySearch([r, active], "888888")).toHaveLength(1);
  });

  it("retorna array vazio quando nada bate", () => {
    expect(filterBySearch([handoff, active], "xyz_inexistente")).toHaveLength(0);
  });

  it("ignora busca com apenas espaços", () => {
    expect(filterBySearch([handoff, active], "   ")).toHaveLength(2);
  });
});

describe("resolveEmConversa", () => {
  it("filter=all → ordena por mensagem mais recente primeiro", () => {
    const recent = row({ convId: "recent", leadName: "Recente", lastMessageAt: new Date("2026-06-11T12:00:00.000Z") });
    const older = row({
      convId: "older",
      leadName: "Antigo",
      aiPaused: true,
      needsAttention: true,
      lastMessageAt: new Date("2026-06-11T10:00:00.000Z"),
    });

    const result = resolveEmConversa([older], [recent], "all", "");

    expect(result[0].convId).toBe("recent");
    expect(result[1].convId).toBe("older");
  });

  it("filter=all → inclui leads agendados passados como ativos", () => {
    const result = resolveEmConversa([handoff], [active, scheduled], "all", "");
    expect(result).toHaveLength(3);
    expect(result.some((r) => r.convId === "s1")).toBe(true);
  });

  it("filter=attention → somente handoff", () => {
    const result = resolveEmConversa([handoff], [active], "attention", "");
    expect(result).toHaveLength(1);
    expect(result[0].convId).toBe("h1");
  });

  it("aplica busca por nome dentro do filtro", () => {
    const result = resolveEmConversa([handoff], [active], "all", "ativo");
    expect(result).toHaveLength(1);
    expect(result[0].convId).toBe("a1");
  });

  it("busca encontra lead agendado pelo nome", () => {
    const result = resolveEmConversa([], [active, scheduled], "all", "agendado");
    expect(result).toHaveLength(1);
    expect(result[0].convId).toBe("s1");
  });
});

describe("sortInboxRowsByRecency", () => {
  it("ordena as conversas pela mensagem mais recente primeiro", () => {
    const older = row({ convId: "older", lastMessageAt: new Date("2026-06-11T10:00:00.000Z") });
    const newest = row({ convId: "newest", lastMessageAt: new Date("2026-06-11T12:00:00.000Z"), leadTemperature: "cold" });
    const middle = row({ convId: "middle", lastMessageAt: new Date("2026-06-11T11:00:00.000Z"), needsAttention: true });

    const result = sortInboxRowsByRecency([older, newest, middle]);

    expect(result.map((item) => item.convId)).toEqual(["newest", "middle", "older"]);
  });

  it("mantém conversa sem timestamp por último", () => {
    const noTimestamp = row({ convId: "no-ts", lastMessageAt: null });
    const recent = row({ convId: "recent", lastMessageAt: new Date("2026-06-11T12:00:00.000Z") });

    const result = sortInboxRowsByRecency([noTimestamp, recent]);

    expect(result.map((item) => item.convId)).toEqual(["recent", "no-ts"]);
  });
});

describe("filterLiveRowsByTab", () => {
  it("retorna apenas conversas em pausa manual na aba pausados", () => {
    const paused = row({ convId: "paused", aiPaused: true, needsAttention: false });
    const attention = row({ convId: "attention", aiPaused: true, needsAttention: true });
    const activeRow = row({ convId: "active", aiPaused: false, needsAttention: false });

    const result = filterLiveRowsByTab([paused, attention, activeRow], "paused");

    expect(result.map((item) => item.convId)).toEqual(["paused"]);
  });
});
