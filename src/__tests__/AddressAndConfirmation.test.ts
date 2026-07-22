// Itens #22 e #23 do plano de correção. Referência: o print do template que o
// operador da Vitalli manda à mão (21/07) — data e horário em linhas rotuladas,
// complemento do endereço em linha própria e link do Maps, que o WhatsApp
// renderiza com foto do prédio.
import { describe, expect, it } from "vitest";
import { buildAddressAnswer, buildAddressLines } from "@/core/conversation/AddressBlock";
import {
  buildAppointmentConfirmationMessage,
  buildDepositConfirmationMessage,
  splitSlotLabel,
} from "@/core/conversation/DepositTemplates";
import { buildLocationClinicContext } from "@/core/pipeline/ConversationOrchestrator";

const VITALLI = {
  address: "Av. Adolfo Pinheiro, 1.029 - Santo Amaro",
  addressComplement: "Helbor Offices Torre Sul, Sala 124, Andar 12",
  mapsUrl: "https://maps.app.goo.gl/exemplo",
};

describe("bloco de endereço (#23)", () => {
  it("complemento e link saem em linhas próprias", () => {
    expect(buildAddressLines(VITALLI)).toEqual([
      "📍 Av. Adolfo Pinheiro, 1.029 - Santo Amaro",
      "Helbor Offices Torre Sul, Sala 124, Andar 12",
      "https://maps.app.goo.gl/exemplo",
    ]);
  });

  it("o link fica sozinho na linha — grudado em texto o WhatsApp não pré-visualiza", () => {
    const linhas = buildAddressLines(VITALLI);
    expect(linhas[linhas.length - 1]).toBe(VITALLI.mapsUrl);
  });

  it("campo não preenchido não vira linha vazia nem texto inventado", () => {
    expect(buildAddressLines({ address: "Rua Guararapes, 1894 — Brooklin Novo" })).toEqual([
      "📍 Rua Guararapes, 1894 — Brooklin Novo",
    ]);
    expect(buildAddressLines({ address: "Rua X", addressComplement: "   ", mapsUrl: "" })).toEqual([
      "📍 Rua X",
    ]);
  });

  it("sem endereço cadastrado não devolve nada — quem chama decide o que dizer", () => {
    expect(buildAddressLines({ address: null })).toEqual([]);
    expect(buildAddressAnswer({ address: null })).toBe("");
  });

  it("resposta direta mantém a frase e ganha as linhas novas", () => {
    expect(buildAddressAnswer(VITALLI)).toBe(
      "📍 Estamos na Av. Adolfo Pinheiro, 1.029 - Santo Amaro.\n" +
        "Helbor Offices Torre Sul, Sala 124, Andar 12\n" +
        "https://maps.app.goo.gl/exemplo",
    );
  });

  it("contexto de localização leva complemento e link para a LLM", () => {
    const ctx = buildLocationClinicContext(VITALLI);
    expect(ctx).toContain("Sala 124");
    expect(ctx).toContain("https://maps.app.goo.gl/exemplo");
    // compatibilidade com as chamadas antigas que passavam só a string
    expect(buildLocationClinicContext("Rua X, 1")).toContain("Rua X, 1");
  });
});

describe("confirmação de agendamento (#22)", () => {
  it("separa data e horário em linhas rotuladas", () => {
    const texto = buildAppointmentConfirmationMessage({
      clinic: { ...VITALLI, depositConfirmationNotes: null },
      slotLabel: "Ter 28/07 às 16h",
    });
    expect(texto).toContain("📅 Data: Ter 28/07");
    expect(texto).toContain("🕒 Horário: 16h");
    expect(texto).toContain("📍 Endereço: Av. Adolfo Pinheiro");
    expect(texto).toContain("Helbor Offices Torre Sul, Sala 124, Andar 12");
    expect(texto).toContain("https://maps.app.goo.gl/exemplo");
  });

  it("as orientações da clínica saem em bloco próprio, como cadastradas", () => {
    const texto = buildAppointmentConfirmationMessage({
      clinic: {
        ...VITALLI,
        depositConfirmationNotes: "Chegar 10 minutos antes.\n⚠️ *EVITAR LEVAR ACOMPANHANTE*",
      },
      slotLabel: "Ter 28/07 às 16h",
    });
    expect(texto).toContain("Orientações importantes:");
    expect(texto).toContain("⚠️ *EVITAR LEVAR ACOMPANHANTE*");
  });

  it("o caminho com sinal usa exatamente o mesmo template", () => {
    const clinic = { ...VITALLI, depositConfirmationNotes: "Chegar 10 minutos antes." };
    expect(buildDepositConfirmationMessage(clinic, "Ter 28/07 às 16h")).toBe(
      buildAppointmentConfirmationMessage({ clinic, slotLabel: "Ter 28/07 às 16h" }),
    );
  });

  it("procedimento entra quando o sistema sabe qual é", () => {
    const texto = buildAppointmentConfirmationMessage({
      clinic: VITALLI,
      slotLabel: "Ter 28/07 às 16h",
      treatmentName: "Lentes em Resina Composta",
    });
    expect(texto).toContain("💠 Procedimento: Lentes em Resina Composta");
  });

  it("clínica sem endereço não gera linha de endereço órfã", () => {
    const texto = buildAppointmentConfirmationMessage({
      clinic: { address: null },
      slotLabel: "Ter 28/07 às 16h",
    });
    expect(texto).not.toContain("📍");
    expect(texto).toContain("🕒 Horário: 16h");
  });

  it("label fora do padrão não quebra a mensagem", () => {
    // Se algum formatador mudar, cai no rótulo único em vez de inventar horário.
    expect(splitSlotLabel("amanhã de manhã")).toEqual({ date: "amanhã de manhã", time: null });
    const texto = buildAppointmentConfirmationMessage({
      clinic: VITALLI,
      slotLabel: "amanhã de manhã",
    });
    expect(texto).toContain("📅 amanhã de manhã");
    expect(texto).not.toContain("🕒");
  });

  it("aceita o formato longo de confirmação", () => {
    expect(splitSlotLabel("segunda-feira, dia 26 de maio às 14h")).toEqual({
      date: "segunda-feira, dia 26 de maio",
      time: "14h",
    });
  });
});
