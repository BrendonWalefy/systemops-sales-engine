import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NAVIGATION_COUNT_KEY,
  NAVIGATION_MARK_KEY,
} from "@/application/observability/navigation-timing";
import { MemoryStorage } from "./helpers/memory-storage";

/**
 * `fetch` nativo é uma operação WebIDL que exige um receptor Window/WorkerGlobalScope:
 * chamado com um `this` diferente — como acontece em `deps.fetch(...)`, onde `deps` é
 * um objeto qualquer — o navegador real lança `TypeError: Illegal invocation`. Um
 * `vi.fn()` comum não impõe essa checagem de receptor, então um mock ingênuo passa
 * igualmente com `deps.fetch = globalThis.fetch` (sem bind) ou com
 * `deps.fetch = globalThis.fetch.bind(globalThis)`. Este stub reproduz a checagem de
 * receptor do navegador para que o teste realmente dependa de
 * `content-ready-reporter.tsx` chamar `.bind(globalThis)`.
 */
function createReceiverEnforcingFetch(expectedReceiver: unknown) {
  const successfulCalls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const fn = vi.fn(function (this: unknown, input: unknown, init?: RequestInit) {
    if (this !== expectedReceiver) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    successfulCalls.push({ input, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  return { fn, successfulCalls };
}

// "Primeiro content-ready do documento" é estado de MÓDULO no reporter (é uma
// propriedade do documento carregado, não do componente). Cada teste precisa
// de um documento novo, então o módulo é reimportado a cada um.
async function freshReporter() {
  vi.resetModules();
  const mod = await import("@/components/performance/content-ready-reporter");
  return mod.ContentReadyReporter;
}

function stubBrowser(storage: MemoryStorage, nowMs: number, fetch: unknown) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { sessionStorage: storage });
  vi.stubGlobal("performance", { now: () => nowMs });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

beforeEach(() => {
  const realConsoleError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((message, ...args) => {
    if (String(message).includes("react-test-renderer is deprecated")) return;
    realConsoleError(message, ...args);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ContentReadyReporter component integration", () => {
  it("does not dispatch a sample on the document's first render when there is no navigation mark", async () => {
    const storage = new MemoryStorage();
    const { fn: fetch, successfulCalls } = createReceiverEnforcingFetch(globalThis);
    stubBrowser(storage, 125, fetch);

    const ContentReadyReporter = await freshReporter();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ContentReadyReporter, { surface: "inbox_list" }));
    });

    // Deixa o microtask do fetch (que resolve ou lança de forma síncrona dentro
    // do try/catch do componente) se propagar antes de inspecionar o resultado.
    await Promise.resolve();
    await Promise.resolve();

    // Sem marca de navegação, "primeiro render do documento" NÃO é prova de
    // carregamento duro: uma navegação suave vinda de uma página sem
    // `ContentReadyReporter` (ex.: Dashboard → Inbox) também chega aqui sem
    // marca e também é o primeiro mount deste documento. Os dois casos são
    // indistinguíveis, então nenhuma amostra pode ser enviada sob nome de
    // operação nenhum — nem `content_ready` nem `app_first_open`. Antes desta
    // correção, este cenário emitia `app_first_open` com `durationMs` igual
    // ao tempo de sessão inteiro, que para uma leitura demorada do Dashboard
    // chegava a dezenas de segundos contra um alvo de 1,5s.
    expect(fetch).not.toHaveBeenCalled();
    expect(successfulCalls).toHaveLength(0);

    // Amostra descartada por falta de ponto de partida não pode gastar a
    // cota de amostras da sessão.
    expect(storage.getItem(NAVIGATION_COUNT_KEY)).toBeNull();

    await act(async () => renderer.unmount());
  });

  it("com marca de navegação, mede da navegação até o paint — não desde o timeOrigin", async () => {
    const storage = new MemoryStorage();
    // Sessão aberta há 45s; o clique que abriu a conversa foi em 45.000ms.
    storage.setItem(
      NAVIGATION_MARK_KEY,
      JSON.stringify({ surface: "conversation", startedAt: 45_000 }),
    );
    const { fn: fetch, successfulCalls } = createReceiverEnforcingFetch(globalThis);
    stubBrowser(storage, 45_450, fetch);

    const ContentReadyReporter = await freshReporter();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ContentReadyReporter, { surface: "conversation" }));
    });
    await Promise.resolve();
    await Promise.resolve();

    const body: unknown = JSON.parse(String(successfulCalls[0].init?.body));
    expect(body).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "conversation",
      operation: "content_ready",
      durationMs: 450,
      cacheState: "unknown",
      outcome: "ok",
    });

    // A marca NÃO é consumida aqui: quem a remove é o
    // NavigationPerformanceReporter, ao emitir o soft_navigation.
    expect(storage.getItem(NAVIGATION_MARK_KEY)).not.toBeNull();

    await act(async () => renderer.unmount());
  });

  it("uma marca de OUTRA superfície não é usada como ponto de partida, e nada é emitido", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      NAVIGATION_MARK_KEY,
      JSON.stringify({ surface: "agenda", startedAt: 45_000 }),
    );
    const { fn: fetch, successfulCalls } = createReceiverEnforcingFetch(globalThis);
    stubBrowser(storage, 45_450, fetch);

    const ContentReadyReporter = await freshReporter();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ContentReadyReporter, { surface: "conversation" }));
    });
    await Promise.resolve();
    await Promise.resolve();

    // Não é medido como content_ready (a marca é de outra superfície, então
    // não é um ponto de partida válido para esta) nem emitido como
    // app_first_open (este mount é o primeiro do documento, mas isso também
    // é verdade para uma navegação suave vinda de uma página sem
    // ContentReadyReporter — os dois casos são indistinguíveis daqui). Amostra
    // nenhuma é enviada; regressão pinada para o bug em que este caso
    // produzia `app_first_open` com `durationMs` igual ao tempo de sessão
    // inteiro (45.450 aqui), e não à navegação real.
    expect(fetch).not.toHaveBeenCalled();
    expect(successfulCalls).toHaveLength(0);
    expect(storage.getItem(NAVIGATION_COUNT_KEY)).toBeNull();

    await act(async () => renderer.unmount());
  });
});
