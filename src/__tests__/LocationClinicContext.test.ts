// Tests for buildLocationClinicContext — pure function that composes the
// clinicContext string passed to ResponseComposer when a lead selects "Localização".

import { describe, it, expect } from "vitest";
import { buildLocationClinicContext } from "@/core/pipeline/ConversationOrchestrator";

describe("buildLocationClinicContext", () => {
  const BASE =
    `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;

  it("returns base instruction when address is null", () => {
    expect(buildLocationClinicContext(null)).toBe(BASE);
  });

  it("appends address line when address is provided", () => {
    const result = buildLocationClinicContext("Rua das Flores, 123 - Centro");
    expect(result).toBe(`${BASE}\nEndereço: Rua das Flores, 123 - Centro.`);
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
