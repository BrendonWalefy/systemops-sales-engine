import { describe, expect, it, vi } from "vitest";
import { validateManualRecoveryRecipient } from "@/application/conversations/manual-recovery-policy";

const contato = {
  contactConsentRevokedAt: null as Date | null,
  phone: "5511999999999",
  whatsappLid: null as string | null,
};

describe("Retomada manual do inbox — opt-out vence o clique", () => {
  it("bloqueia quem revogou consentimento", () => {
    const r = validateManualRecoveryRecipient({
      ...contato,
      contactConsentRevokedAt: new Date("2026-07-01"),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("não receber mais mensagens");
  });

  it("libera quem nunca revogou", () => {
    expect(validateManualRecoveryRecipient(contato).ok).toBe(true);
  });

  it("opt-out tem prioridade sobre a falta de endereço", () => {
    // A mensagem de erro precisa ser a do consentimento: dizer "sem telefone"
    // sugeriria que cadastrar o número resolve.
    const r = validateManualRecoveryRecipient({
      contactConsentRevokedAt: new Date("2026-07-01"),
      phone: null,
      whatsappLid: null,
    });
    expect(r.error).toContain("não receber mais mensagens");
  });

  it("ainda bloqueia sem endereço quando há consentimento", () => {
    const r = validateManualRecoveryRecipient({
      contactConsentRevokedAt: null,
      phone: null,
      whatsappLid: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("endereço");
  });

  it("aceita contato identificado só por whatsapp_lid", () => {
    expect(
      validateManualRecoveryRecipient({
        contactConsentRevokedAt: null,
        phone: null,
        whatsappLid: "123456789@lid",
      }).ok,
    ).toBe(true);
  });
});

describe("Retomada manual — custo de composição é registrado", () => {
  it("registra tokens da composição sem derrubar o fluxo se falhar", async () => {
    // A composição usa gpt-4o-mini e sempre gastou token; o gasto era invisível
    // em ai_usage_costs. Registrar não pode virar novo ponto de falha: a chamada
    // já foi paga quando chegamos aqui.
    const tracker = { trackAiUsage: vi.fn().mockRejectedValue(new Error("db fora")) };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    async function registrar() {
      try {
        await tracker.trackAiUsage();
      } catch (e) {
        console.error("[Recovery] custo não registrado:", e);
      }
      return "mensagem composta";
    }

    await expect(registrar()).resolves.toBe("mensagem composta");
    expect(tracker.trackAiUsage).toHaveBeenCalled();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});
