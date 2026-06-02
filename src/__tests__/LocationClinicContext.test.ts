// Tests for buildLocationClinicContext — pure function that composes the
// clinicContext string passed to ResponseComposer when a lead selects "Localização".

import { describe, it, expect } from "vitest";
import {
  buildLocationClinicContext,
  buildProceduresClinicContext,
  extractProcedureNamesFromPlaybook,
} from "@/core/pipeline/ConversationOrchestrator";

describe("buildLocationClinicContext", () => {
  const BASE =
    `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;

  it("forbids address invention when address is null", () => {
    const result = buildLocationClinicContext(null);
    expect(result).toContain(BASE);
    expect(result).toContain("NÃO invente endereço");
    expect(result).toContain("Endereço não cadastrado");
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

describe("buildProceduresClinicContext", () => {
  const playbook = `ESPECIALIDADE: Odontologia

SERVIÇOS OFERECIDOS:
A clínica oferece tratamentos completos.

LIMPEZA DENTAL
Profilaxia completa.

CLAREAMENTO DENTAL
Clareamento a laser ou caseiro.

TRATAMENTO DE CANAL (Endodontia)
Preserva o dente natural.

DIFERENCIAIS DA CLÍNICA:
- Atendimento exclusivo`;

  it("extracts procedure names from compiled playbook services section", () => {
    expect(extractProcedureNamesFromPlaybook(playbook)).toEqual([
      "LIMPEZA DENTAL",
      "CLAREAMENTO DENTAL",
      "TRATAMENTO DE CANAL (Endodontia)",
    ]);
  });

  it("prefers playbook procedure names over treatment rows", () => {
    const context = buildProceduresClinicContext(
      [
        {
          id: "t1",
          clinicId: "c1",
          name: "Tabela incompleta",
          durationMinutes: 60,
          description: null,
          commonObjections: [],
          requiresEvaluationFirst: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      playbook,
    );

    expect(context).toContain("1. LIMPEZA DENTAL");
    expect(context).toContain("3. TRATAMENTO DE CANAL (Endodontia)");
    expect(context).not.toContain("Tabela incompleta");
    expect(context).toContain("Se quiser, pode digitar *menu*");
  });

  it("falls back to treatment rows when playbook has no services section", () => {
    const context = buildProceduresClinicContext(
      [
        {
          id: "t1",
          clinicId: "c1",
          name: "Avaliação",
          durationMinutes: 60,
          description: null,
          commonObjections: [],
          requiresEvaluationFirst: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      "ESPECIALIDADE: Odontologia",
    );

    expect(context).toContain("1. Avaliação");
  });
});
