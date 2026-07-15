// Guardas de isolamento da Biblioteca de Mídia — mídia NUNCA vaza entre
// organizações nem entre procedimentos. Ver docs/product/biblioteca-midia-plano.md.
import { describe, expect, it, vi } from "vitest";
import {
  filterMediaLibraryForTreatment,
  mergeDeliveryMediaLibrary,
  resolveOutboundParts,
} from "@/core/pipeline/ConversationOrchestrator";
import type { ResponsePart } from "@/core/intelligence/ResponseComposer";
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
