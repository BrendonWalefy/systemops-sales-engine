// `content_ready` mede "quanto tempo da navegação até o conteúdo pintado".
// A versão anterior enviava `Math.round(performance.now())`, que é o tempo
// desde o `timeOrigin` do DOCUMENTO — numa navegação suave, o carregamento
// original da aba. Uma conversa aberta 45s depois de entrar no app reportava
// ~45.000ms contra um alvo de 800ms.
//
// O irmão (navigation-timing.ts) já fazia certo: `now - pending.startedAt`,
// com `startedAt` gravado no clique por markNavigationStartInSession. Aqui a
// mesma marca passa a alimentar o content_ready.
//
// E o caso sem marca (carregamento duro, não navegação suave) é decidido de
// propósito: aí `timeOrigin` É o início da navegação, então `performance.now()`
// vale — e é exatamente a medida de "primeira abertura do app", então sai como
// `app_first_open`, não como um `content_ready` de número inflado.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NAVIGATION_COUNT_KEY,
  NAVIGATION_MARK_KEY,
} from "@/application/observability/navigation-timing";
import { emitContentReadySample } from "@/components/performance/content-ready-reporter";
import { MemoryStorage } from "./helpers/memory-storage";

type SentSample = {
  operation: string;
  surface: string;
  durationMs: number;
  cacheState?: string;
};

function sentSamples(fetch: ReturnType<typeof vi.fn>): SentSample[] {
  return fetch.mock.calls.map(
    (call) => JSON.parse(String((call[1] as RequestInit).body)) as SentSample,
  );
}

describe("content_ready mede a partir do início da navegação", () => {
  let storage: MemoryStorage;
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = new MemoryStorage();
    fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  });

  function markNavigation(surface: string, startedAt: number) {
    storage.setItem(NAVIGATION_MARK_KEY, JSON.stringify({ surface, startedAt }));
  }

  it("mede da marca de navegação até o paint, não do timeOrigin da sessão", () => {
    // Sessão aberta há 45s; o clique que abriu esta conversa foi em 45.000ms
    // e o conteúdo pintou em 45.450ms. A amostra tem que ser 450, não 45.450.
    markNavigation("conversation", 45_000);

    emitContentReadySample("conversation", {
      storage,
      fetch,
      now: () => 45_450,
      navigationStartedAt: 45_000,
      isFirstInDocument: false,
    });

    expect(sentSamples(fetch)).toEqual([
      expect.objectContaining({ operation: "content_ready", durationMs: 450 }),
    ]);
  });

  it("no carregamento duro (sem marca) emite app_first_open com o tempo desde o timeOrigin", () => {
    // Sem navegação suave anterior, `timeOrigin` É o início da navegação:
    // `performance.now()` no paint é a medida certa — e a medida que o alvo
    // "primeira abertura do app" pede.
    emitContentReadySample("inbox_list", {
      storage,
      fetch,
      now: () => 1_240,
      navigationStartedAt: null,
      isFirstInDocument: true,
    });

    expect(sentSamples(fetch)).toEqual([
      expect.objectContaining({
        operation: "app_first_open",
        surface: "inbox_list",
        durationMs: 1_240,
        cacheState: "cold",
      }),
    ]);
  });

  it("sem marca e já não é o primeiro render do documento: não emite NADA", () => {
    // Este é o caso que produzia o número enganoso. Um `router.refresh()` ou
    // um link que não marcou o início não têm ponto de partida conhecido —
    // emitir o tempo de sessão sob o mesmo nome de operação contamina a
    // amostra com números que não medem o que a operação diz medir.
    emitContentReadySample("inbox_list", {
      storage,
      fetch,
      now: () => 87_000,
      navigationStartedAt: null,
      isFirstInDocument: false,
    });

    expect(fetch).not.toHaveBeenCalled();
    // E não consome orçamento de amostras da sessão.
    expect(storage.getItem(NAVIGATION_COUNT_KEY)).toBeNull();
  });

  it("descarta uma marca do futuro (duração negativa) em vez de enviar lixo", () => {
    emitContentReadySample("conversation", {
      storage,
      fetch,
      now: () => 1_000,
      navigationStartedAt: 5_000,
      isFirstInDocument: false,
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("descarta uma duração absurda (aba parada no meio da navegação)", () => {
    emitContentReadySample("conversation", {
      storage,
      fetch,
      now: () => 10 * 60_000,
      navigationStartedAt: 0,
      isFirstInDocument: false,
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("continua respeitando o orçamento por sessão quando há marca", () => {
    for (let i = 0; i < 35; i++) {
      emitContentReadySample("conversation", {
        storage,
        fetch,
        now: () => 500,
        navigationStartedAt: 100,
        isFirstInDocument: false,
      });
    }

    expect(fetch).toHaveBeenCalledTimes(30);
  });

  it("markNavigation escreve a marca na chave que o content_ready lê", () => {
    // Guarda contra a marca e a leitura divergirem de chave em silêncio.
    markNavigation("conversation", 10);
    expect(storage.getItem(NAVIGATION_MARK_KEY)).toBe(
      JSON.stringify({ surface: "conversation", startedAt: 10 }),
    );
  });
});
