// Guards determinísticos P0 — casos reais das conversas da Ximendes (jun-jul/2026):
// starter genérico engolindo pergunta de negócio (Tania, Julllys, Carla),
// follow-up de madrugada (lote de 02:43), oferta expirada dita "indisponível"
// com o mesmo horário na lista (Aylane), markdown ** cru no WhatsApp.
import { describe, expect, it } from "vitest";
import {
  coerceBusinessIntent,
  detectPatientArrivalText,
  findExpressedSlotIndex,
} from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { toWhatsAppFormatting } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    commonObjections: [],
    requiresEvaluationFirst: false,
    triggerTemplate: null,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const treatments = [
  treatment("Lentes de resina composta", { aliases: ["lentes", "faceta"] }),
  treatment("Clareamento dental", { aliases: ["clareamento"] }),
];

const saoPaulo = new ClinicTimezone("America/Sao_Paulo");

describe("coerceBusinessIntent", () => {
  it("pergunta de preço classificada como acknowledgment vira price_inquiry (caso Tania)", () => {
    const result = coerceBusinessIntent({
      message: "Olá! Posso ter mais informações sobre custo ?",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("pergunta de valores classificada como greeting vira price_inquiry (caso Julllys)", () => {
    const result = coerceBusinessIntent({
      message: "Olá boa tarde!! E qual seria os valores?",
      intent: "greeting",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("aviso de chegada classificado como acknowledgment vira patient_arrived (caso Carla)", () => {
    const result = coerceBusinessIntent({
      message: "Oi, bom dia, tudo bem? Eu estou aqui na frente mas ninguém atende.",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("patient_arrived");
  });

  it("menção direta a tratamento classificada como unclear vira general_question", () => {
    const result = coerceBusinessIntent({
      message: "clareamento",
      intent: "unclear",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("general_question");
  });

  it("saudação pura permanece greeting", () => {
    const result = coerceBusinessIntent({
      message: "Boa noite",
      intent: "greeting",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("greeting");
  });

  it("não sobrescreve intents de negócio já corretos", () => {
    const result = coerceBusinessIntent({
      message: "quanto custa o clareamento?",
      intent: "price_inquiry",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("chegada não dispara fora do segmento clínico", () => {
    const result = coerceBusinessIntent({
      message: "cheguei",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: false,
    });
    expect(result).toBe("acknowledgment");
  });
});

describe("detectPatientArrivalText", () => {
  it("detecta variações reais de chegada", () => {
    expect(detectPatientArrivalText("cheguei")).toBe(true);
    expect(detectPatientArrivalText("Já estou aí na recepção")).toBe(true);
    expect(detectPatientArrivalText("to na porta")).toBe(true);
  });

  it("não dispara com 'estou aqui' genérico", () => {
    expect(detectPatientArrivalText("estou aqui pensando nos valores")).toBe(false);
  });
});

describe("ClinicTimezone.isWithinContactWindow", () => {
  it("bloqueia madrugada local (caso do lote de 02:43 BRT)", () => {
    // 05:43 UTC = 02:43 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-06-15T05:43:11Z"))).toBe(false);
  });

  it("permite horário comercial local", () => {
    // 13:00 UTC = 10:00 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-07-03T13:00:00Z"))).toBe(true);
  });

  it("bloqueia após o fim da janela", () => {
    // 23:30 UTC = 20:30 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-07-03T23:30:00Z"))).toBe(false);
  });
});

describe("findExpressedSlotIndex", () => {
  // Sex 03/07/2026: 08h, 09h e 12h locais (UTC-3)
  const slots = [
    { index: 1, startsAt: "2026-07-03T11:00:00.000Z" },
    { index: 2, startsAt: "2026-07-03T12:00:00.000Z" },
    { index: 3, startsAt: "2026-07-03T15:00:00.000Z" },
    { index: 4, startsAt: "2026-07-06T15:00:00.000Z" },
  ];

  it("aponta o horário pedido quando é único (caso Aylane: 'As 12hs' + sexta)", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "As 12hs",
      preferredDay: new Date("2026-07-03T15:00:00.000Z"),
      timezone: saoPaulo,
    });
    expect(index).toBe(3);
  });

  it("retorna null quando a hora casa com mais de um dia (ambíguo)", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "12h",
      preferredDay: null,
      timezone: saoPaulo,
    });
    expect(index).toBeNull();
  });

  it("retorna null quando o horário pedido não existe na lista", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "16:00",
      preferredDay: null,
      timezone: saoPaulo,
    });
    expect(index).toBeNull();
  });

  it("retorna null sem preferência expressa", () => {
    expect(findExpressedSlotIndex({ slots, preferredTime: null, preferredDay: null, timezone: saoPaulo })).toBeNull();
  });
});

describe("toWhatsAppFormatting", () => {
  it("converte markdown bold para o formato do WhatsApp", () => {
    expect(toWhatsAppFormatting("**Técnica Simplificada**: a partir de R$2.500")).toBe(
      "*Técnica Simplificada*: a partir de R$2.500",
    );
  });

  it("não altera texto sem markdown", () => {
    expect(toWhatsAppFormatting("Valor *promocional* até sexta")).toBe("Valor *promocional* até sexta");
  });
});
