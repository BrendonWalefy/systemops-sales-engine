// Tests for inbox filter logic — pure functions, no DOM needed.

import { describe, it, expect } from "vitest";
import { filterBySearch, resolveEmConversa, sortInboxRowsByRecency } from "@/app/(clinic)/app/inbox/inbox-filter";
import { resolveInboxPendingAction } from "@/app/(clinic)/app/inbox/inbox-pending";
import type { ConvRow } from "@/app/(clinic)/app/inbox/InboxClient";

function row(overrides: Partial<ConvRow> & { convId: string }): ConvRow {
  return {
    leadId: "lead-1",
    lastMessageAt: new Date(),
    latestMessageAt: undefined,
    lastReadAt: null,
    needsAttention: false,
    attentionReason: null,
    aiPaused: false,
    conversationCategory: "sales",
    leadName: "Lead",
    leadPhone: "5511999999999",
    leadStatus: "new",
    leadTemperature: "warm",
    leadTreatmentInterest: null,
    leadProfilePicUrl: null,
    pendingAction: null,
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

  it("ordena só por lastMessageAt — latestMessageAt não influencia mais a ordem", () => {
    // Fix round 1 — Important #2: o servidor pagina por conversations.lastMessageAt
    // (Task 2 index), não por latestMessageAt (sentAt da última mensagem, de
    // qualquer autor). Se o cliente reordenasse pela chave errada, uma
    // conversa poderia aparecer no topo da lista renderizada mesmo tendo
    // ficado de fora da página que o servidor buscou — ou vice-versa.
    const respondedRecently = row({
      convId: "responded",
      lastMessageAt: new Date("2026-06-11T10:00:00.000Z"),
      latestMessageAt: new Date("2026-06-11T12:00:00.000Z"),
    });
    const leadWroteLater = row({
      convId: "waiting",
      lastMessageAt: new Date("2026-06-11T11:00:00.000Z"),
      latestMessageAt: new Date("2026-06-11T11:00:00.000Z"),
    });

    const result = sortInboxRowsByRecency([respondedRecently, leadWroteLater]);

    expect(result.map((item) => item.convId)).toEqual(["waiting", "responded"]);
  });

  it("desempata lastMessageAt igual por convId DESCENDENTE — mesmo critério do ORDER BY do servidor", () => {
    const tie = new Date("2026-06-11T10:00:00.000Z");
    const result = sortInboxRowsByRecency([
      row({ convId: "conv-aaa", lastMessageAt: tie }),
      row({ convId: "conv-zzz", lastMessageAt: tie }),
    ]);

    expect(result.map((item) => item.convId)).toEqual(["conv-zzz", "conv-aaa"]);
  });
});

describe("resolveInboxPendingAction", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("classifica o lead que ainda não enviou o comprovante", () => {
    expect(resolveInboxPendingAction({
      latestConversationState: "awaiting_deposit_proof",
      latestStateExpiresAt: new Date("2026-07-19T13:00:00.000Z"),
      hasPendingHumanReview: false,
      attentionReason: null,
      now,
    })).toBe("deposit_proof");
  });

  it("não ressuscita uma espera de comprovante cujo hold expirou", () => {
    expect(resolveInboxPendingAction({
      latestConversationState: "awaiting_deposit_proof",
      latestStateExpiresAt: new Date("2026-07-19T11:00:00.000Z"),
      hasPendingHumanReview: false,
      attentionReason: null,
      now,
    })).toBeNull();
  });

  it("classifica comprovante recebido e revisão pendente do doutor", () => {
    expect(resolveInboxPendingAction({
      latestConversationState: "deposit_proof_received",
      latestStateExpiresAt: null,
      hasPendingHumanReview: false,
      attentionReason: null,
      now,
    })).toBe("deposit_validation");

    expect(resolveInboxPendingAction({
      latestConversationState: "idle",
      latestStateExpiresAt: null,
      hasPendingHumanReview: true,
      attentionReason: null,
      now,
    })).toBe("doctor_review");
  });

  it("mantém avaliações legadas sinalizadas deterministicamente pelo Orchestrator", () => {
    expect(resolveInboxPendingAction({
      latestConversationState: null,
      latestStateExpiresAt: null,
      hasPendingHumanReview: false,
      attentionReason: "Lead enviou foto para avaliação",
      now,
    })).toBe("doctor_review");
  });
});
