import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildConciergeStarter } from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type { Organization } from "@/domain/entities/clinic";

const SAO_PAULO = new ClinicTimezone("America/Sao_Paulo");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-15T23:00:00Z")); // 20h SP → "Boa noite"
});
afterAll(() => {
  vi.useRealTimers();
});

function makeClinic(overrides: Partial<Organization>): Organization {
  return {
    name: "Clínica Vitalli",
    greetingMessage: null,
    ...overrides,
  } as unknown as Organization;
}

// A2 — Persona unificada: o starter concierge nunca se apresenta como "assistente
// virtual" e usa o opener curado da clínica quando existe (padrão da operadora Gleice).
describe("buildConciergeStarter — persona humana", () => {
  const VITALLI_OPENER =
    "Olá, tudo bem? Me chamo Gleice, sou da Clínica Vitalli. Vi que você se interessou pelos nossos casos de lentes em resina. Me conta, você quer entender melhor como funciona, ver valores ou já procurar um horário para avaliação?";

  it("usa o opener curado da clínica e nunca diz 'assistente virtual'", () => {
    const clinic = makeClinic({ greetingMessage: VITALLI_OPENER });
    const result = buildConciergeStarter(clinic, SAO_PAULO, "Alex", "Gleice");

    expect(result).not.toMatch(/assistente virtual/i);
    expect(result).toContain("Me chamo Gleice");
    // A pergunta de qualificação do opener é preservada.
    expect(result).toContain("ver valores");
    expect(result).toContain("avaliação");
  });

  it("usa greetingMessage verbatim quando ele já abre com saudação temporal", () => {
    const clinic = makeClinic({
      greetingMessage: "Boa tarde! Aqui é a Gleice da Vitalli, como posso ajudar?",
    });
    const result = buildConciergeStarter(clinic, SAO_PAULO, "Alex", "Gleice");
    expect(result).toBe("Boa tarde! Aqui é a Gleice da Vitalli, como posso ajudar?");
    expect(result).not.toMatch(/assistente virtual/i);
  });

  it("fallback sem greetingMessage: usa a recepcionista do editorial, sem 'assistente virtual'", () => {
    const clinic = makeClinic({ greetingMessage: null });
    const result = buildConciergeStarter(clinic, SAO_PAULO, "Alex", "Gleice");
    expect(result).toContain("Sou a Gleice, da Clínica Vitalli.");
    expect(result).not.toMatch(/assistente virtual/i);
    expect(result).toMatch(/^Boa noite, Alex\. Tudo bem\?/);
  });

  it("fallback sem greeting e sem recepcionista: fala como 'a equipe'", () => {
    const clinic = makeClinic({ greetingMessage: null });
    const result = buildConciergeStarter(clinic, SAO_PAULO, null, null);
    expect(result).toContain("Aqui é a equipe da Clínica Vitalli.");
    expect(result).not.toMatch(/assistente virtual/i);
  });

  it("não insere nome de exibição inválido ('ocupado') na saudação de fallback", () => {
    const clinic = makeClinic({ greetingMessage: null });
    const result = buildConciergeStarter(clinic, SAO_PAULO, "ocupado", "Gleice");
    expect(result).not.toMatch(/ocupado/i);
    expect(result).toMatch(/^Boa noite\. Tudo bem\?/);
  });
});
