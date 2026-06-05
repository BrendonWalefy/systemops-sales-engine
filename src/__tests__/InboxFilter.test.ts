// Tests for inbox filter logic — pure functions, no DOM needed.

import { describe, it, expect } from "vitest";
import { filterBySearch, resolveEmConversa } from "@/app/(clinic)/app/inbox/inbox-filter";
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
  it("filter=all → handoff primeiro, depois ativos", () => {
    const result = resolveEmConversa([handoff], [active], "all", "");
    expect(result[0].convId).toBe("h1");
    expect(result[1].convId).toBe("a1");
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
