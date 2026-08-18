import { describe, expect, it, vi } from "vitest";
import { buildTurnFailureReport } from "@/core/pipeline/turn-failure-report";

// O catch de topo do orquestrador engole qualquer falha do turno e faz handoff
// silencioso. Sem captura real, o operador vê "IA indisponível" no inbox e
// ninguém no time descobre por quê — a falha existia só no console de uma
// invocação serverless já encerrada.
describe("relato de falha do turno", () => {
  const identifiers = {
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    leadId: "lead-1",
    messageId: "message-1",
  };

  it("reporta o erro com identificadores técnicos como contexto do logger", () => {
    const error = new Error("Neon connection reset");
    const log = { error: vi.fn() };

    buildTurnFailureReport({ ...identifiers, error, log: log as never });

    expect(log.error).toHaveBeenCalledOnce();
    const [message, reportedError, extra] = log.error.mock.calls[0]!;
    expect(message).toBe("turn processing failed — silent handoff");
    expect(reportedError).toBe(error);
    expect(extra).toEqual({ leadId: "lead-1", messageId: "message-1" });
  });

  it("não carrega corpo de conversa nem dado do lead no relato", () => {
    const leadBody = "Oi, meu nome é Maria e meu telefone é 11 98888-7777";
    const log = { error: vi.fn() };

    buildTurnFailureReport({
      ...identifiers,
      error: new Error("falha após ler a mensagem"),
      log: log as never,
    });

    // O contrato é estrutural: a função só aceita identificadores, então não há
    // parâmetro por onde o texto do lead pudesse entrar.
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(leadBody);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("Maria");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("98888");
  });

  it("aceita rejeição que não é Error sem perder o relato", () => {
    const log = { error: vi.fn() };

    buildTurnFailureReport({ ...identifiers, error: "string solta", log: log as never });

    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error.mock.calls[0]![1]).toBe("string solta");
  });
});
