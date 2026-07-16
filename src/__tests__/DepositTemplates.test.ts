import { describe, it, expect } from "vitest";
import {
  buildDepositRequestMessage,
  buildDepositConfirmationMessage,
  buildDepositProofReceivedMessage,
  buildDepositExpiredMessage,
  buildDepositProofMissingMessage,
  type DepositClinic,
} from "@/core/conversation/DepositTemplates";

// Config real da Vitalli.
const VITALLI: DepositClinic = {
  depositAmountCents: 3000,
  depositPixKey: "54659849000109",
  depositPixKeyType: "cnpj",
  depositRecipientName: "Dr. Victor Cavalcante",
  depositTtlHours: 24,
  depositNotes: "O valor do sinal é abatido do procedimento.",
  depositConfirmationNotes: "• Chegue 10 minutos antes.\n• Reagende com 24h de antecedência.\n• Evite trazer acompanhante.",
  address: "Av. Adolfo Pinheiro, 1.029 - Santo Amaro, Sala 124",
};

describe("DepositTemplates", () => {
  it("pedido de sinal traz valor, chave, titular, prazo e a regra de confirmação", () => {
    const msg = buildDepositRequestMessage(VITALLI, "Seg 21/07 às 09h");
    expect(msg).toContain("Seg 21/07 às 09h");
    expect(msg).toContain("R$ 30");
    expect(msg).toContain("Chave Pix (CNPJ): 54659849000109");
    expect(msg).toContain("Nome: Dr. Victor Cavalcante");
    expect(msg).toContain("O valor do sinal é abatido do procedimento.");
    expect(msg).toContain("24 horas");
    expect(msg).toMatch(/só é confirmado após a comprovação/i);
  });

  it("confirmação traz data, endereço e as orientações fixas da clínica", () => {
    const msg = buildDepositConfirmationMessage(VITALLI, "Seg 21/07 às 09h");
    expect(msg).toContain("✅ Agendamento confirmado!");
    expect(msg).toContain("📅 Seg 21/07 às 09h");
    expect(msg).toContain("Av. Adolfo Pinheiro");
    expect(msg).toContain("Evite trazer acompanhante");
  });

  it("comprovante recebido e reserva expirada têm textos fixos e claros", () => {
    expect(buildDepositProofReceivedMessage()).toMatch(/recebemos seu comprovante/i);
    expect(buildDepositExpiredMessage()).toMatch(/expirou e foi liberado/i);
    expect(buildDepositProofMissingMessage()).toMatch(/comprovante/i);
  });

  it("prazo em dias quando múltiplo de 24h", () => {
    const msg = buildDepositRequestMessage({ ...VITALLI, depositTtlHours: 48 }, "Seg 21/07 às 09h");
    expect(msg).toContain("2 dias");
  });

  it("sem endereço/notas: não quebra nem deixa linhas órfãs", () => {
    const bare: DepositClinic = { depositAmountCents: 5000, depositPixKey: "x@y.com", depositPixKeyType: "email", depositRecipientName: "Fulano" };
    const req = buildDepositRequestMessage(bare, "Ter 22/07 às 16h");
    expect(req).toContain("Chave Pix (e-mail): x@y.com");
    expect(req).not.toMatch(/\n\n\n/);
    const conf = buildDepositConfirmationMessage(bare, "Ter 22/07 às 16h");
    expect(conf).toContain("✅ Agendamento confirmado!");
    expect(conf).not.toMatch(/\n\n\n/);
  });
});
