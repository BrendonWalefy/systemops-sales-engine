import { describe, it, expect } from "vitest";
import { buildPromptContext } from "@/core/intelligence/PromptContextBuilder";

const dentalBase = {
  segment: "dental",
  specialty: "odontologia",
  serviceNoun: "tratamento",
  bookingNoun: "consulta",
  contactNoun: "paciente",
  agentRole: "recepcionista virtual",
  businessDescriptor: null,
};

const atelierBase = {
  segment: "atelier",
  specialty: "moda",
  serviceNoun: "pedido",
  bookingNoun: "entrega",
  contactNoun: "cliente",
  agentRole: "atendente virtual",
  businessDescriptor: "ateliê especializado em uniformes, bordados e peças personalizadas",
};

describe("buildPromptContext", () => {
  it("dental: isClinicSegment = true", () => {
    const ctx = buildPromptContext(dentalBase);
    expect(ctx.isClinicSegment).toBe(true);
  });

  it("dental: businessDescriptor fallback usa specialty", () => {
    const ctx = buildPromptContext(dentalBase);
    expect(ctx.businessDescriptor).toBe("clínica de odontologia");
  });

  it("dental: vocabulário padrão preservado", () => {
    const ctx = buildPromptContext(dentalBase);
    expect(ctx.agentRole).toBe("recepcionista virtual");
    expect(ctx.bookingNoun).toBe("consulta");
    expect(ctx.contactNoun).toBe("paciente");
    expect(ctx.serviceNoun).toBe("tratamento");
  });

  it("atelier: isClinicSegment = false", () => {
    const ctx = buildPromptContext(atelierBase);
    expect(ctx.isClinicSegment).toBe(false);
  });

  it("atelier: businessDescriptor usa o valor do campo", () => {
    const ctx = buildPromptContext(atelierBase);
    expect(ctx.businessDescriptor).toBe(
      "ateliê especializado em uniformes, bordados e peças personalizadas",
    );
  });

  it("atelier: vocabulário correto para o segmento", () => {
    const ctx = buildPromptContext(atelierBase);
    expect(ctx.agentRole).toBe("atendente virtual");
    expect(ctx.bookingNoun).toBe("entrega");
    expect(ctx.contactNoun).toBe("cliente");
    expect(ctx.serviceNoun).toBe("pedido");
  });

  it("estétic segment: isClinicSegment = true", () => {
    const ctx = buildPromptContext({ ...atelierBase, segment: "estetica" });
    expect(ctx.isClinicSegment).toBe(true);
  });

  it("odonto segment: isClinicSegment = true", () => {
    const ctx = buildPromptContext({ ...dentalBase, segment: "odonto" });
    expect(ctx.isClinicSegment).toBe(true);
  });

  it("other segment: isClinicSegment = false", () => {
    const ctx = buildPromptContext({ ...atelierBase, segment: "other" });
    expect(ctx.isClinicSegment).toBe(false);
  });
});
