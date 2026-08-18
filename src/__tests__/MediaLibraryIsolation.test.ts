// Guardas de isolamento da Biblioteca de Mídia — mídia NUNCA vaza entre
// organizações nem entre procedimentos. Ver docs/features.md.
import { describe, expect, it, vi } from "vitest";
import {
  collectPipelineStepMediaIds,
  filterMediaLibraryForComposer,
  filterMediaLibraryForTreatment,
  mergeDeliveryMediaLibrary,
  resolveOutboundParts,
} from "@/core/pipeline/ConversationOrchestrator";
import type { ResponsePart } from "@/core/intelligence/ResponseComposer";
import type { Treatment } from "@/domain/entities/treatment";
import type { Logger } from "@/infrastructure/logging/logger";

function fakeLogger(): Logger & { errors: { message: string; extra?: Record<string, unknown> }[] } {
  const errors: { message: string; extra?: Record<string, unknown> }[] = [];
  return {
    errors,
    info: vi.fn(),
    warn: vi.fn(),
    error: (message, _err, extra) => {
      errors.push({ message, extra });
    },
    child: () => fakeLogger(),
  };
}

type LibItem = { id: string; title: string; type: "video" | "image"; url: string; treatmentId?: string | null };

const LENTES_VIDEO: LibItem = { id: "lentes-1", title: "Lentes", type: "video", url: "https://blob/lentes.mp4", treatmentId: "treatment-lentes" };
const IMPLANTE_VIDEO: LibItem = { id: "implante-1", title: "Implante", type: "video", url: "https://blob/implante.mp4", treatmentId: "treatment-implante" };
const GENERAL_IMAGE: LibItem = { id: "geral-1", title: "Sorriso antes/depois", type: "image", url: "https://blob/sorriso.jpg", treatmentId: null };

describe("filterMediaLibraryForTreatment — isolamento no prompt", () => {
  it("sem tratamento ativo, retorna a lista completa (comportamento de hoje)", () => {
    const result = filterMediaLibraryForTreatment([LENTES_VIDEO, IMPLANTE_VIDEO, GENERAL_IMAGE], null);
    expect(result).toHaveLength(3);
  });

  it("com tratamento ativo, exclui mídia de OUTRO procedimento", () => {
    const result = filterMediaLibraryForTreatment([LENTES_VIDEO, IMPLANTE_VIDEO, GENERAL_IMAGE], "treatment-lentes");
    expect(result.map((m) => m.id)).toEqual(["lentes-1", "geral-1"]);
    expect(result.map((m) => m.id)).not.toContain("implante-1");
  });

  it("mídia geral (treatmentId null) sempre aparece, qualquer tratamento ativo", () => {
    const result = filterMediaLibraryForTreatment([GENERAL_IMAGE], "treatment-qualquer-coisa");
    expect(result).toHaveLength(1);
  });

  it("todos os assets migrados nascem treatmentId=null — backfill nunca filtra nada (zero regressão)", () => {
    const legacyBackfilled: LibItem[] = [
      { id: "a", title: "A", type: "video", url: "u1", treatmentId: null },
      { id: "b", title: "B", type: "video", url: "u2", treatmentId: null },
    ];
    const result = filterMediaLibraryForTreatment(legacyBackfilled, "qualquer-treatment-ativo");
    expect(result).toHaveLength(2);
  });
});

describe("filterMediaLibraryForComposer — mídia adequada por intenção", () => {
  const OLD_RESULT_VIDEO: LibItem = {
    id: "old-result-estratificada",
    title: "Resultado Lente em Resina Estratificada",
    type: "video",
    url: "https://blob/resultado-estratificada.mp4",
    treatmentId: "treatment-lentes",
  };
  const NEW_PRICE_PREMIUM: LibItem = {
    id: "new-price-premium",
    title: "Valores Lente em Resina Premium",
    type: "image",
    url: "https://blob/valores-premium.jpg",
    treatmentId: "treatment-lentes",
  };
  const NEW_PRICE_ESTRATIFICADA: LibItem = {
    id: "new-price-estratificada",
    title: "Valores Lente em Resina Estratificada",
    type: "image",
    url: "https://blob/valores-estratificada.jpg",
    treatmentId: "treatment-lentes",
  };

  it("em pergunta de preço, oferece somente mídias de valores quando elas existem", () => {
    const result = filterMediaLibraryForComposer(
      [OLD_RESULT_VIDEO, NEW_PRICE_PREMIUM, NEW_PRICE_ESTRATIFICADA],
      "treatment-lentes",
      { type: "price_inquiry" },
    );

    expect(result.map((m) => m.id)).toEqual(["new-price-premium", "new-price-estratificada"]);
  });

  it("em pergunta de preço, preserva fallback quando não existe mídia de valores", () => {
    const result = filterMediaLibraryForComposer(
      [OLD_RESULT_VIDEO],
      "treatment-lentes",
      { type: "price_inquiry" },
    );

    expect(result.map((m) => m.id)).toEqual(["old-result-estratificada"]);
  });

  it("fora de preço, preserva as mídias do tratamento", () => {
    const result = filterMediaLibraryForComposer(
      [OLD_RESULT_VIDEO, NEW_PRICE_PREMIUM],
      "treatment-lentes",
      { type: "general_question", clinicContext: "Lead perguntou sobre lentes." },
    );

    expect(result.map((m) => m.id)).toEqual(["old-result-estratificada", "new-price-premium"]);
  });
});

// Regressão de 28/07: "quanto custa?" sem arte de valores caía no fallback da
// lista inteira, então a LLM anexava o card de "envie sua foto para
// pré-avaliação" e reenviava vídeos de técnica que o pipeline já havia mostrado.
describe("collectPipelineStepMediaIds — mídia que o pipeline entrega no ritmo dele", () => {
  function treatment(overrides: Partial<Treatment> & { id: string }): Treatment {
    return {
      clinicId: "clinic-1",
      name: overrides.id,
      durationMinutes: 60,
      description: null,
      requiresEvaluationFirst: false,
      keywordMatchEnabled: true,
      aliases: [],
      isAesthetic: false,
      pipelineSteps: null,
      pipelineSourceTreatmentId: null,
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
    } as Treatment;
  }

  const LENTES = treatment({
    id: "treatment-lentes",
    pipelineSteps: [
      {
        type: "content",
        label: "Técnicas",
        blocks: [
          { kind: "text", content: "Temos duas técnicas." },
          { kind: "media", mediaId: "video-tecnica" },
        ],
      },
      { type: "qa", label: "Dúvidas", mediaOnKeywords: [{ keywords: ["cor"], mediaId: "tabela-cores" }] },
      { type: "photo", label: "Foto", message: "Manda uma foto do seu sorriso?", required: false },
    ],
  });

  it("coleta mídia de bloco de conteúdo e de mediaOnKeywords da Q&A", () => {
    const ids = collectPipelineStepMediaIds(LENTES, [LENTES]);
    expect([...ids].sort()).toEqual(["tabela-cores", "video-tecnica"]);
  });

  it("variação herda a mídia do pipeline do tratamento-fonte", () => {
    const variacao = treatment({
      id: "treatment-lentes-premium",
      pipelineSourceTreatmentId: "treatment-lentes",
    });
    const ids = collectPipelineStepMediaIds(variacao, [LENTES, variacao]);
    expect([...ids].sort()).toEqual(["tabela-cores", "video-tecnica"]);
  });

  it("sem tratamento ativo, não exclui nada", () => {
    expect(collectPipelineStepMediaIds(null, [LENTES]).size).toBe(0);
  });

  it("no preço sem arte de valores, o fallback não devolve mídia de passo do pipeline", () => {
    const library: LibItem[] = [
      { id: "video-tecnica", title: "Como funciona a lente", type: "video", url: "u1", treatmentId: "treatment-lentes" },
      { id: "vitrine-sorriso", title: "Sorriso antes e depois", type: "image", url: "u2", treatmentId: "treatment-lentes" },
    ];
    const result = filterMediaLibraryForComposer(
      library,
      "treatment-lentes",
      { type: "price_inquiry" },
      collectPipelineStepMediaIds(LENTES, [LENTES]),
    );

    expect(result.map((m) => m.id)).toEqual(["vitrine-sorriso"]);
  });

  it("arte de valores vence mesmo sendo mídia de passo do pipeline — clínica que cota por imagem", () => {
    const library: LibItem[] = [
      { id: "video-tecnica", title: "Valores das lentes", type: "image", url: "u1", treatmentId: "treatment-lentes" },
    ];
    const result = filterMediaLibraryForComposer(
      library,
      "treatment-lentes",
      { type: "price_inquiry" },
      collectPipelineStepMediaIds(LENTES, [LENTES]),
    );

    expect(result.map((m) => m.id)).toEqual(["video-tecnica"]);
  });

  it("fora de preço, a exclusão não se aplica — o pipeline segue dono do próprio ritmo", () => {
    const library: LibItem[] = [
      { id: "video-tecnica", title: "Como funciona a lente", type: "video", url: "u1", treatmentId: "treatment-lentes" },
    ];
    const result = filterMediaLibraryForComposer(
      library,
      "treatment-lentes",
      { type: "general_question", clinicContext: "Lead perguntou sobre lentes." },
      collectPipelineStepMediaIds(LENTES, [LENTES]),
    );

    expect(result.map((m) => m.id)).toEqual(["video-tecnica"]);
  });
});

describe("resolveOutboundParts — gate determinístico de isolamento no ENVIO", () => {
  const library = [LENTES_VIDEO, IMPLANTE_VIDEO, GENERAL_IMAGE];

  it("envia mídia cujo treatmentId bate com o tratamento ativo da conversa", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "media", id: "lentes-1" }];
    const out = resolveOutboundParts(parts, library, log, "treatment-lentes");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "media", mediaId: "lentes-1" });
    expect(log.errors).toHaveLength(0);
  });

  it("BLOQUEIA mídia de outro procedimento mesmo que a LLM tenha emitido o token — alucinação não escapa este gate", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "media", id: "implante-1" }];
    const out = resolveOutboundParts(parts, library, log, "treatment-lentes");
    expect(out).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0].message).toContain("outro procedimento");
  });

  it("mídia geral (treatmentId null) sempre passa, independente do tratamento ativo", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "media", id: "geral-1" }];
    const out = resolveOutboundParts(parts, library, log, "treatment-implante");
    expect(out).toHaveLength(1);
    expect(log.errors).toHaveLength(0);
  });

  it("sem tratamento ativo (null), qualquer mídia da lista passa — comportamento de hoje preservado", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "media", id: "implante-1" }];
    const out = resolveOutboundParts(parts, library, log, null);
    expect(out).toHaveLength(1);
    expect(log.errors).toHaveLength(0);
  });

  it("mediaId inexistente continua sendo bloqueado e logado (comportamento pré-existente preservado)", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "media", id: "id-que-nao-existe" }];
    const out = resolveOutboundParts(parts, library, log, null);
    expect(out).toHaveLength(0);
    expect(log.errors[0].message).toContain("não encontrado na biblioteca");
  });

  it("texto passa direto, sem gate de tratamento", () => {
    const log = fakeLogger();
    const parts: ResponsePart[] = [{ type: "text", content: "Olá!" }];
    const out = resolveOutboundParts(parts, library, log, "treatment-lentes");
    expect(out).toEqual([{ type: "text", content: "Olá!" }]);
  });
});

describe("mergeDeliveryMediaLibrary — mídia declarada no pipeline", () => {
  it("entrega asset referenciado diretamente pelo pipeline mesmo fora da curadoria do playbook ativo", () => {
    const log = fakeLogger();
    const merged = mergeDeliveryMediaLibrary([], [LENTES_VIDEO]);
    const parts: ResponsePart[] = [{ type: "media", id: "lentes-1" }];

    const out = resolveOutboundParts(parts, merged, log, "treatment-lentes");

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "media",
      mediaId: "lentes-1",
      url: "https://blob/lentes.mp4",
    });
    expect(log.errors).toHaveLength(0);
  });

  it("mantém o gate de tratamento mesmo para asset adicionado por referência direta", () => {
    const log = fakeLogger();
    const merged = mergeDeliveryMediaLibrary([], [IMPLANTE_VIDEO]);
    const parts: ResponsePart[] = [{ type: "media", id: "implante-1" }];

    const out = resolveOutboundParts(parts, merged, log, "treatment-lentes");

    expect(out).toHaveLength(0);
    expect(log.errors[0].message).toContain("outro procedimento");
  });
});
