import { describe, expect, it } from "vitest";
import {
  validateDeadLetterResolution,
  type DeadLetterCandidate,
} from "@/application/jobs/manage-dead-letters";

const now = new Date("2026-07-27T15:00:00.000Z");

function candidate(overrides: Partial<DeadLetterCandidate> = {}): DeadLetterCandidate {
  return {
    id: "job-1",
    queue: "message.send",
    status: "dead",
    createdAt: new Date("2026-07-27T14:55:00.000Z"),
    resolved: false,
    outboundStatus: "dead",
    ...overrides,
  };
}

describe("dead letter management", () => {
  it("permite reprocessar uma entrega recente e consistente", () => {
    expect(() => validateDeadLetterResolution(candidate(), {
      action: "reprocess",
      reason: "Credencial corrigida",
      now,
    })).not.toThrow();
  });

  it("bloqueia entrega tardia sem confirmação explícita", () => {
    expect(() => validateDeadLetterResolution(candidate({
      createdAt: new Date("2026-07-27T12:00:00.000Z"),
    }), {
      action: "reprocess",
      reason: "Credencial corrigida",
      now,
    })).toThrow("Entrega tardia bloqueada");
  });

  it("permite override tardio explícito e auditável", () => {
    expect(() => validateDeadLetterResolution(candidate({
      createdAt: new Date("2026-07-27T12:00:00.000Z"),
    }), {
      action: "reprocess",
      reason: "Lead confirmou reenvio manualmente",
      allowLateDelivery: true,
      now,
    })).not.toThrow();
  });

  it("rejeita job já resolvido, job ativo e outbox incompatível", () => {
    expect(() => validateDeadLetterResolution(candidate({ resolved: true }), {
      action: "discard",
      reason: "Falha analisada e encerrada",
    })).toThrow("já foi resolvido");
    expect(() => validateDeadLetterResolution(candidate({ status: "pending" }), {
      action: "acknowledge",
      reason: "Falha analisada e encerrada",
    })).toThrow("não está morto");
    expect(() => validateDeadLetterResolution(candidate({ outboundStatus: "sent" }), {
      action: "reprocess",
      reason: "Falha analisada e encerrada",
    })).toThrow("mensagem de saída não está morta");
  });
});
