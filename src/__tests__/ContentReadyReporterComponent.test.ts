import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentReadyReporter } from "@/components/performance/content-ready-reporter";
import { NAVIGATION_COUNT_KEY } from "@/application/observability/navigation-timing";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  get length(): number {
    return this.values.size;
  }
}

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ContentReadyReporter component integration", () => {
  it("dispatches the content-ready sample only when fetch is called with the global receiver", async () => {
    const storage = new MemoryStorage();
    const { fn: fetch, successfulCalls } = createReceiverEnforcingFetch(globalThis);

    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { sessionStorage: storage });
    vi.stubGlobal("performance", { now: () => 125 });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const realConsoleError = console.error.bind(console);
    vi.spyOn(console, "error").mockImplementation((message, ...args) => {
      if (String(message).includes("react-test-renderer is deprecated")) return;
      realConsoleError(message, ...args);
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(ContentReadyReporter, { surface: "inbox_list" }));
    });

    // Deixa o microtask do fetch (que resolve ou lança de forma síncrona dentro
    // do try/catch do componente) se propagar antes de inspecionar o resultado.
    await Promise.resolve();
    await Promise.resolve();

    // A checagem que importa: o fetch precisa ter sido chamado com o receptor
    // certo e ter completado com sucesso. Não basta "nenhuma exceção escapou" —
    // o contador de sessão é incrementado ANTES do fetch (linha 34 do
    // componente) e o try/catch do componente engole silenciosamente qualquer
    // `TypeError: Illegal invocation` vindo de um fetch desvinculado. Se
    // `.bind(globalThis)` for removido de content-ready-reporter.tsx:60, este
    // stub lança, `successfulCalls` fica vazio e a asserção abaixo falha.
    expect(successfulCalls).toHaveLength(1);
    expect(successfulCalls[0].input).toBe("/api/telemetry/performance");
    expect(successfulCalls[0].init).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
      }),
    );

    const body: unknown = JSON.parse(String(successfulCalls[0].init?.body));
    expect(body).toEqual({
      schemaVersion: 1,
      source: "client",
      surface: "inbox_list",
      operation: "content_ready",
      durationMs: 125,
      cacheState: "unknown",
      outcome: "ok",
    });

    expect(storage.getItem(NAVIGATION_COUNT_KEY)).toBe("1");

    await act(async () => renderer.unmount());
  });
});
