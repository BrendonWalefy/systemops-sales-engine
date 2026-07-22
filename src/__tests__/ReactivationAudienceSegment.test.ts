import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT,
  MAX_LIFETIME_CAMPAIGN_CAP,
  MIN_EXCLUDE_CONTACTED_WITHIN_DAYS,
  MIN_WINDOW_TO_DAYS_AGO,
  describeSegment,
  parseSegment,
  validateSegment,
  type AudienceSegment,
} from "@/application/reactivation/audience-segment";

function segment(overrides: Partial<AudienceSegment> = {}): AudienceSegment {
  return { ...DEFAULT_SEGMENT, ...overrides };
}

function fields(errors: { field: string }[]): string[] {
  return errors.map((e) => e.field);
}

describe("AudienceSegment — janela temporal", () => {
  it("aceita o default", () => {
    expect(validateSegment(DEFAULT_SEGMENT)).toEqual([]);
  });

  it("recusa janela invertida", () => {
    const errors = validateSegment(segment({ windowFromDaysAgo: 5, windowToDaysAgo: 20 }));
    expect(fields(errors)).toContain("windowFromDaysAgo");
  });

  it("recusa janela de tamanho zero", () => {
    const errors = validateSegment(segment({ windowFromDaysAgo: 10, windowToDaysAgo: 10 }));
    expect(fields(errors)).toContain("windowFromDaysAgo");
  });

  it("exige folga no fim da janela — conversa recente pode estar viva", () => {
    const errors = validateSegment(
      segment({ windowFromDaysAgo: 14, windowToDaysAgo: MIN_WINDOW_TO_DAYS_AGO - 1 }),
    );
    expect(fields(errors)).toContain("windowToDaysAgo");
  });

  it("recusa janela maior que um ano", () => {
    expect(fields(validateSegment(segment({ windowFromDaysAgo: 400 })))).toContain(
      "windowFromDaysAgo",
    );
  });

  it("recusa dias fracionários", () => {
    expect(fields(validateSegment(segment({ windowFromDaysAgo: 14.5 })))).toContain(
      "windowFromDaysAgo",
    );
  });
});

describe("AudienceSegment — filtros de seleção", () => {
  it("aceita motivos válidos", () => {
    expect(validateSegment(segment({ outcomeReasons: ["price", "schedule"] }))).toEqual([]);
  });

  it("recusa motivo desconhecido", () => {
    const errors = validateSegment(
      segment({ outcomeReasons: ["achou_caro"] as never }),
    );
    expect(fields(errors)).toContain("outcomeReasons");
  });

  it("recusa status de quem já fechou", () => {
    // Campanha de reativação para quem agendou ou fechou é justamente o
    // constrangimento que não pode acontecer.
    for (const status of ["won", "appointment_scheduled"]) {
      const errors = validateSegment(segment({ leadStatuses: [status] as never }));
      expect(fields(errors)).toContain("leadStatuses");
    }
  });

  it("aceita lost — é exatamente o público de reativação", () => {
    expect(validateSegment(segment({ leadStatuses: ["lost"] }))).toEqual([]);
  });

  it("recusa confiança fora de 0-100", () => {
    expect(fields(validateSegment(segment({ minConfidence: 120 })))).toContain("minConfidence");
    expect(fields(validateSegment(segment({ minConfidence: -1 })))).toContain("minConfidence");
  });
});

describe("AudienceSegment — exclusões de segurança", () => {
  it("recusa intervalo entre contatos abaixo do mínimo", () => {
    const errors = validateSegment(
      segment({ excludeContactedWithinDays: MIN_EXCLUDE_CONTACTED_WITHIN_DAYS - 1 }),
    );
    expect(fields(errors)).toContain("excludeContactedWithinDays");
  });

  it("recusa desligar a exclusão de contato recente", () => {
    expect(fields(validateSegment(segment({ excludeContactedWithinDays: 0 })))).toContain(
      "excludeContactedWithinDays",
    );
  });

  it("recusa cap de vida acima do teto absoluto", () => {
    const errors = validateSegment(
      segment({ lifetimeCampaignCap: MAX_LIFETIME_CAMPAIGN_CAP + 1 }),
    );
    expect(fields(errors)).toContain("lifetimeCampaignCap");
  });

  it("recusa cap de vida zero ou negativo", () => {
    expect(fields(validateSegment(segment({ lifetimeCampaignCap: 0 })))).toContain(
      "lifetimeCampaignCap",
    );
  });
});

describe("AudienceSegment — parse de entrada crua", () => {
  it("aplica defaults quando não vem nada", () => {
    const { segment: s, errors } = parseSegment({});
    expect(errors).toEqual([]);
    expect(s).toMatchObject({
      windowFromDaysAgo: DEFAULT_SEGMENT.windowFromDaysAgo,
      excludeContactedWithinDays: DEFAULT_SEGMENT.excludeContactedWithinDays,
      lifetimeCampaignCap: DEFAULT_SEGMENT.lifetimeCampaignCap,
    });
  });

  it("aceita números vindos como string de formulário", () => {
    const { segment: s, errors } = parseSegment({
      windowFromDaysAgo: "14",
      windowToDaysAgo: "3",
      excludeContactedWithinDays: "7",
      lifetimeCampaignCap: "2",
    });
    expect(errors).toEqual([]);
    expect(s.windowFromDaysAgo).toBe(14);
    expect(s.windowToDaysAgo).toBe(3);
  });

  it("não silencia entrada inválida — devolve o erro", () => {
    const { errors } = parseSegment({ windowFromDaysAgo: 3, windowToDaysAgo: 10 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("cai no default quando o valor não é numérico, mas ainda valida", () => {
    const { segment: s, errors } = parseSegment({ lifetimeCampaignCap: "abacaxi" });
    expect(s.lifetimeCampaignCap).toBe(DEFAULT_SEGMENT.lifetimeCampaignCap);
    expect(errors).toEqual([]);
  });

  it("parse de null não explode", () => {
    expect(() => parseSegment(null)).not.toThrow();
    expect(parseSegment(null).errors).toEqual([]);
  });
});

describe("AudienceSegment — descrição legível", () => {
  it("descreve janela e exclusões", () => {
    const texto = describeSegment(
      segment({ windowFromDaysAgo: 14, windowToDaysAgo: 2, outcomeReasons: ["price"] }),
    );
    expect(texto).toContain("14");
    expect(texto).toContain("price");
    expect(texto).toContain("7 dias");
    expect(texto).toContain("3 campanhas");
  });
});
