import { describe, expect, it } from "vitest";
import {
  resolveDirectTreatmentMention,
  resolveInformationalTreatmentTarget,
  resolveMediaScopeTreatmentId,
  resolvePipelineTreatmentMention,
  resolvePriceTreatmentTarget,
  resolveSchedulingTreatmentTarget,
  shouldBypassPendingPipelineContent,
} from "@/core/pipeline/ConversationOrchestrator";
import type { ProcedureListItem } from "@/core/conversation/ConversationStateMachine";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const treatments = [
  treatment("Avaliação odontológica"),
  treatment("Lentes de resina composta"),
  treatment("Clareamento dental"),
];

const selectedLenses: ProcedureListItem = {
  index: 2,
  treatmentId: "lentes-de-resina-composta",
  name: "Lentes de resina composta",
  description: null,
  durationMinutes: 60,
  requiresEvaluationFirst: false,
};

describe("resolveDirectTreatmentMention", () => {
  it("trata palavra isolada de tratamento como menção informativa direta", () => {
    const result = resolveDirectTreatmentMention("Lentes", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("trata pergunta curta sobre opções de um tratamento como menção informativa", () => {
    const result = resolveDirectTreatmentMention("Tem quais opcoes de lentes?", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("não intercepta pedido explícito de agendamento", () => {
    const result = resolveDirectTreatmentMention("quero agendar uma avaliacao", treatments);
    expect(result).toBeNull();
  });

  it("não intercepta pergunta de preço para o classificador preservar price_inquiry", () => {
    const result = resolveDirectTreatmentMention("qual o valor das lentes?", treatments);
    expect(result).toBeNull();
  });

  it("não confunde 'aonde fica' com o sufixo de 'estratificada'", () => {
    const estratificada = treatment("Lente em Resina Estratificada", {
      aliases: ["estratificada"],
      pipelineSteps: [{
        type: "content",
        label: "Apresentação",
        once: true,
        blocks: [{ kind: "text", content: "Conteúdo" }],
      }],
    });

    expect(
      resolveDirectTreatmentMention("Aonde fica", [estratificada]),
    ).toBeNull();
    expect(
      resolveInformationalTreatmentTarget({
        message: "Aonde fica",
        treatments: [estratificada],
        identifiedTreatment: estratificada.name,
      }),
    ).toBeNull();
    expect(
      resolveDirectTreatmentMention(
        "Esse valor faz na estratificada? Pois quero bem natural",
        [estratificada],
      ),
    ).toBeNull();
    expect(
      resolveInformationalTreatmentTarget({
        message: "Quero uma lente estratificada bem natural",
        treatments: [estratificada],
        identifiedTreatment: estratificada.name,
      })?.id,
    ).toBe(estratificada.id);
  });

  it("não intercepta resposta ao agente quando ele acabou de perguntar o procedimento", () => {
    const result = resolveDirectTreatmentMention(
      "Avaliação",
      treatments,
      "Qual procedimento você gostaria de realizar?",
    );
    expect(result).toBeNull();
  });

  it("ignora seleções numéricas de menu ou lista", () => {
    expect(resolveDirectTreatmentMention("8", treatments)).toBeNull();
  });

  it("detecta tratamento em mensagem de saudação com menção — suporta greeting+pipeline em uma msg", () => {
    const result = resolveDirectTreatmentMention("oi, interesse em lentes", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("detecta tratamento em saudação composta de várias palavras", () => {
    const result = resolveDirectTreatmentMention("boa tarde, gostaria de saber sobre lentes", treatments);
    expect(result?.name).toBe("Lentes de resina composta");
  });
});

describe("guarda de localização", () => {
  it("usa palavras inteiras para não tratar estratificada como 'fica'", () => {
    expect(
      shouldBypassPendingPipelineContent(
        "Quero uma lente estratificada bem natural",
      ),
    ).toBe(false);
    expect(shouldBypassPendingPipelineContent("Aonde fica?")).toBe(true);
  });
});

describe("resolveInformationalTreatmentTarget", () => {
  it("resolve a seleção de tratamento vinda da lista de procedimentos", () => {
    const result = resolveInformationalTreatmentTarget({
      message: "2",
      treatments,
      procedureSelection: selectedLenses,
    });
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("resolve menção informativa curta sem depender do classificador", () => {
    const result = resolveInformationalTreatmentTarget({
      message: "Lentes",
      treatments,
    });
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("resolve pergunta informativa longa que menciona tratamento com pipeline", () => {
    const result = resolveInformationalTreatmentTarget({
      message: "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina?",
      treatments: [
        treatment("Avaliação odontológica"),
        treatment("Lentes de resina composta", {
          aliases: ["lentes", "lentes de resina"],
          pipelineSteps: [
            {
              type: "content",
              label: "Apresentação das técnicas",
              blocks: [{ kind: "text", content: "Apresentação objetiva das lentes." }],
            },
          ],
        }),
      ],
    });

    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("prioriza tratamento identificado pelo classificador quando disponível", () => {
    const result = resolveInformationalTreatmentTarget({
      message: "quero saber mais",
      treatments,
      identifiedTreatment: "Lentes de resina composta",
    });
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("prefere o tratamento com pipeline quando o classificador caiu em uma variante sem pipeline", () => {
    const pipelineTreatment = treatment("Lentes de resina composta simplificada", {
      aliases: ["lentes", "lente", "lentes de contato dental", "simplificada", "estratificada"],
      pipelineSteps: [
        {
          type: "content",
          label: "Intro",
          blocks: [{ kind: "text", content: "Explicação consultiva das técnicas." }],
        },
      ],
    });
    const noPipelineVariant = treatment("Lentes de resina composta estratificada");

    const result = resolveInformationalTreatmentTarget({
      message: "lentes",
      treatments: [pipelineTreatment, noPipelineVariant],
      identifiedTreatment: "Lentes de resina composta estratificada",
    });

    expect(result?.name).toBe("Lentes de resina composta simplificada");
  });

  it("não deixa o classificador trocar uma menção explícita entre variantes com o mesmo pipeline", () => {
    const sharedPipeline = [
      {
        type: "content" as const,
        label: "Apresentação",
        blocks: [{ kind: "text" as const, content: "Explicação das técnicas." }],
      },
    ];
    const estratificada = treatment("Lentes de resina composta estratificada", {
      aliases: ["lentes", "resina", "lentes de resina", "estratificada"],
      pipelineSteps: sharedPipeline,
    });
    const simplificada = treatment("Lentes de resina composta simplificada", {
      aliases: ["lentes", "resina", "lentes de resina", "simplificada"],
      pipelineSteps: sharedPipeline,
    });
    const canonical = treatment("Lentes em Resina Composta", {
      keywordMatchEnabled: false,
      pipelineSteps: sharedPipeline,
    });

    for (const identifiedTreatment of [
      estratificada.name,
      simplificada.name,
      canonical.name,
    ]) {
      const result = resolveInformationalTreatmentTarget({
        message: "Queria saber em relação das lentes de resina",
        treatments: [estratificada, simplificada, canonical],
        identifiedTreatment,
      });

      expect(result?.id).toBe(estratificada.id);
    }
  });
});

describe("resolvePipelineTreatmentMention", () => {
  it("detecta pipeline em pergunta completa com contexto de lentes", () => {
    const result = resolvePipelineTreatmentMention(
      "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina?",
      [
        treatment("Lentes de resina composta", {
          aliases: ["lentes", "lentes de resina"],
          pipelineSteps: [
            {
              type: "content",
              label: "Apresentação das técnicas",
              blocks: [{ kind: "text", content: "Apresentação objetiva das lentes." }],
            },
          ],
        }),
      ],
    );

    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("não captura pedido de valores, que deve continuar no handler de preço", () => {
    const result = resolvePipelineTreatmentMention(
      "Ver valores",
      [
        treatment("Lentes de resina composta", {
          aliases: ["lentes", "lentes de resina"],
          pipelineSteps: [
            {
              type: "content",
              label: "Apresentação das técnicas",
              blocks: [{ kind: "text", content: "Apresentação objetiva das lentes." }],
            },
          ],
        }),
      ],
    );

    expect(result).toBeNull();
  });

  it("reconhece variante específica que herda o pipeline canônico", () => {
    const canonical = treatment("Lentes em Resina Composta", {
      id: "canonical",
      aliases: ["lentes", "lentes de resina"],
      pipelineSteps: [
        { type: "content", label: "Comparação", blocks: [] },
      ],
    });
    const premium = treatment("Lente em Resina Premium", {
      id: "premium",
      aliases: ["premium", "lente premium"],
      pipelineSourceTreatmentId: canonical.id,
    });

    expect(
      resolvePipelineTreatmentMention(
        "Quero conhecer a lente premium",
        [canonical, premium],
      )?.id,
    ).toBe(premium.id);
  });
});

describe("especificidade de variantes", () => {
  it("a técnica explícita vence o alias genérico independentemente da ordem", () => {
    const common = treatment("Extensão de cílios — Técnicas Comuns", {
      aliases: ["cílios", "extensão de cílios", "clássico"],
    });
    const international = treatment("Extensão de cílios — Técnicas Gringas", {
      aliases: ["cílios", "extensão de cílios", "fox eyes", "técnica gringa"],
    });

    for (const ordered of [
      [common, international],
      [international, common],
    ]) {
      expect(
        resolveDirectTreatmentMention("Quero fox eyes", ordered)?.id,
      ).toBe(international.id);
    }
  });

  it("usa o tratamento canônico como escopo de mídia da variante", () => {
    const canonical = treatment("Lentes em Resina Composta", {
      id: "canonical",
      pipelineSteps: [{
        type: "content",
        label: "Apresentação",
        once: true,
        blocks: [{ kind: "text", content: "Conteúdo" }],
      }],
    });
    const estratificada = treatment("Lente em Resina Estratificada", {
      id: "variant",
      pipelineSourceTreatmentId: canonical.id,
    });

    expect(
      resolveMediaScopeTreatmentId({
        classifiedTreatment: estratificada,
        treatments: [estratificada, canonical],
      }),
    ).toBe(canonical.id);
  });

  it("preço de fox eyes resolve a técnica gringa por evidência textual", () => {
    const common = treatment("Extensão de cílios — Técnicas Comuns", {
      id: "common",
      aliases: ["cílios", "extensão de cílios"],
    });
    const international = treatment("Extensão de cílios — Técnicas Gringas", {
      id: "international",
      aliases: ["fox eyes", "técnica gringa", "cílios fox"],
    });

    expect(
      resolvePriceTreatmentTarget({
        message: "Olá, quanto está a aplicação do cílios fox?",
        treatments: [common, international],
        identifiedTreatment: common.name,
      })?.id,
    ).toBe(international.id);
  });

  it("preço de lentes estratificadas resolve a variante plural antes do pai", () => {
    const canonical = treatment("Lentes em Resina Composta", {
      id: "canonical",
      aliases: ["lentes", "lentes de resina", "resina"],
    });
    const estratificada = treatment("Lentes de resina composta estratificada", {
      id: "estratificada",
      aliases: [
        "estratificada",
        "estratificadas",
        "técnica estratificada",
        "lentes de resina estratificadas",
      ],
      pipelineSourceTreatmentId: canonical.id,
    });

    expect(
      resolvePriceTreatmentTarget({
        message: "Tenho interesse em lentes de resina estratificadas na cor BL2",
        treatments: [canonical, estratificada],
        identifiedTreatment: canonical.name,
      })?.id,
    ).toBe(estratificada.id);
  });
});

describe("resolveSchedulingTreatmentTarget", () => {
  it("resolve pedido explícito de agendamento de lentes", () => {
    const result = resolveSchedulingTreatmentTarget({
      message: "quero agendar lentes",
      treatments,
    });
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("resolve pedido de horário para lentes", () => {
    const result = resolveSchedulingTreatmentTarget({
      message: "tem horario para lentes?",
      treatments,
    });
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("não transforma pergunta informativa em agendamento", () => {
    const result = resolveSchedulingTreatmentTarget({
      message: "Lentes",
      treatments,
    });
    expect(result).toBeNull();
  });

  it("não transforma pergunta de preço em agendamento", () => {
    const result = resolveSchedulingTreatmentTarget({
      message: "qual o valor das lentes?",
      treatments,
    });
    expect(result).toBeNull();
  });
});
