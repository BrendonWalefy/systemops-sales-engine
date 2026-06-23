// Tests for buildLocationClinicContext — pure function that composes the
// clinicContext string passed to ResponseComposer when a lead selects "Localização".

import { describe, it, expect } from "vitest";
import { buildLocationClinicContext } from "@/core/pipeline/ConversationOrchestrator";

describe("buildLocationClinicContext", () => {
  const BASE =
    `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;

  it("returns anti-hallucination instruction when address is null", () => {
    const result = buildLocationClinicContext(null);
    expect(result).toContain(BASE);
    expect(result).toContain("NÃO invente endereço");
    expect(result).toContain("não cadastrado no sistema");
  });

  it("appends address line and anti-hallucination guardrail when address is provided", () => {
    const result = buildLocationClinicContext("Rua das Flores, 123 - Centro");
    expect(result).toContain("Rua das Flores, 123 - Centro");
    expect(result).toContain("SOMENTE este endereço");
    expect(result).toContain("NÃO confirme presença em outros bairros");
  });

  it("always contains directive to suppress scheduling invitation", () => {
    const withAddress = buildLocationClinicContext("Av. Paulista, 1000");
    const withoutAddress = buildLocationClinicContext(null);
    expect(withAddress).toContain("Sem convite para agendar ao final");
    expect(withoutAddress).toContain("Sem convite para agendar ao final");
  });

  it("includes address verbatim — no transformation", () => {
    const address = "Rua XV de Novembro, 500 — Curitiba/PR — CEP 80020-310";
    const result = buildLocationClinicContext(address);
    expect(result).toContain(address);
  });
});
