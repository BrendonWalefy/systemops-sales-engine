import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `act` só roda sem warning se o ambiente se declarar compatível — não temos
// jsdom, então declaramos manualmente antes de renderizar.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { InboxPoller } from "@/app/(clinic)/app/inbox/InboxPoller";

function mockFetchVersion(version: string, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => ({ version }),
  });
}

// Stub mínimo de `document` com listeners de verdade: o poller precisa
// reagir a `visibilitychange`, não só ler `document.hidden`.
type DocumentStub = {
  hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  listenerCount(type: string): number;
  dispatch(type: string): void;
};

function installDocumentStub(): DocumentStub {
  const listeners = new Map<string, Set<() => void>>();
  const stub: DocumentStub = {
    hidden: false,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
  (globalThis as unknown as { document: DocumentStub }).document = stub;
  return stub;
}

// O poll imediato da volta de visibilidade resolve em microtasks
// (fetch -> json -> scheduleNext). `advanceTimersByTimeAsync(0)` cede o
// controle uma vez só, então sem drenar a fila o `setTimeout` do próximo poll
// acaba registrado 1ms adiante e escapa da janela de avanço seguinte —
// artefato do relógio falso, não do componente.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

async function render(initialVersion: string): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(InboxPoller, { initialVersion }));
    // Deixa o primeiro setTimeout ser agendado antes de avançar o relógio.
    await vi.advanceTimersByTimeAsync(0);
  });
  return renderer;
}

function fetchCallCount(): number {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
}

describe("InboxPoller", () => {
  let documentStub: DocumentStub;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
    documentStub = installDocumentStub();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "não chama router.refresh() enquanto a versão não muda — nem no minuto em que o " +
      "antigo refresh incondicional disparava (regressão: refresh incondicional)",
    async () => {
      mockFetchVersion("v1");
      const renderer = await render("v1");

      // t=60s era o ponto em que o código antigo forçava router.refresh()
      // mesmo sem nenhuma mudança de versão. O teto novo é bem mais tarde.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(fetchCallCount()).toBeGreaterThan(0);
      expect(refreshMock).not.toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });
    },
  );

  it(
    "mas TEM teto: depois de 4 polls seguidos no degrau de 60s sem mudança, força um " +
      "refresh (transições sem escrita: hoursWaiting, expiresAt, agendamento vencido)",
    async () => {
      mockFetchVersion("v1");
      const renderer = await render("v1");

      // 15s + 30s + 60s*3 = 225s: quarto poll de 60s ainda não aconteceu.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(225_000);
      });
      expect(refreshMock).not.toHaveBeenCalled();

      // t=285s: quarto poll no topo da escada — o teto dispara.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(refreshMock).toHaveBeenCalledTimes(1);

      // Regime permanente: mais 4 polls de 60s até o próximo refresh forçado
      // (a escada NÃO volta pra 15s — a aba ociosa continua barata).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      expect(refreshMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(refreshMock).toHaveBeenCalledTimes(2);

      act(() => {
        renderer.unmount();
      });
    },
  );

  it("chama router.refresh() e zera a escada quando a versão muda", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");

    // Primeiro poll (t=15s): versão ainda igual.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    // Segundo poll (t=15s+30s): a versão mudou.
    mockFetchVersion("v2");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Depois da mudança, a escada reinicia em 15s (índice 0) — não em 60s.
    const fetchCallsBeforeNextTick = fetchCallCount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchCallCount()).toBe(fetchCallsBeforeNextTick + 1);

    act(() => {
      renderer.unmount();
    });
  });

  it("não busca a versão enquanto document.hidden é true, e retoma sozinho quando a aba volta a ficar visível", async () => {
    // Regressão que só "não busca enquanto hidden" não pega: se o poller
    // desse um `return` cedo demais e nunca chamasse scheduleNext() de novo,
    // o fetch também ficaria em zero pra sempre — passaria pela mesma
    // asserção. Só fica provado que o laço continua vivo se ele voltar a
    // buscar depois que a aba fica visível de novo.
    mockFetchVersion("v1");
    const renderer = await render("v1");

    documentStub.hidden = true;
    const callsWhileHidden = fetchCallCount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchCallCount()).toBe(callsWhileHidden);

    documentStub.hidden = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchCallCount()).toBeGreaterThan(callsWhileHidden);

    act(() => {
      renderer.unmount();
    });
  });

  it("busca na hora quando a aba volta a ficar visível — sem esperar o degrau corrente vencer", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");

    // Leva a escada até o topo (60s) para que o próximo poll agendado esteja
    // longe: sem o listener, voltar à aba renderia até um minuto de espera.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(105_000);
    });

    documentStub.hidden = true;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const callsBeforeReturn = fetchCallCount();

    documentStub.hidden = false;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      // Nenhum avanço de relógio: o poll tem que sair imediatamente.
      await settle();
    });

    expect(fetchCallCount()).toBe(callsBeforeReturn + 1);

    // E a escada voltou ao começo: o poll imediato conta como um poll sem
    // mudança (streak 0 -> 1), então o próximo sai no SEGUNDO degrau, 30s —
    // não nos 60s do topo em que a aba estava antes de ser escondida.
    const callsAfterReturn = fetchCallCount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(fetchCallCount()).toBe(callsAfterReturn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchCallCount()).toBe(callsAfterReturn + 1);

    act(() => {
      renderer.unmount();
    });
  });

  it("uma aba escondida por mais que o degrau de topo volta com refresh forçado", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");

    documentStub.hidden = true;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      // Três horas fora: hoursWaiting, expiresAt e agendamentos mudaram de
      // categoria sem nenhuma escrita, então a versão pode estar idêntica.
      await vi.advanceTimersByTimeAsync(3 * 3600_000);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    documentStub.hidden = false;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      await settle();
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
  });

  it("alt-tab rápido não paga refresh — só o poll imediato", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");

    documentStub.hidden = true;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      await vi.advanceTimersByTimeAsync(5_000);
    });

    documentStub.hidden = false;
    await act(async () => {
      documentStub.dispatch("visibilitychange");
      await settle();
    });

    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it("desmontar remove o listener de visibilidade", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");
    expect(documentStub.listenerCount("visibilitychange")).toBe(1);

    act(() => {
      renderer.unmount();
    });

    expect(documentStub.listenerCount("visibilitychange")).toBe(0);
  });

  it("voltar à aba não duplica o laço de polling", async () => {
    // Sem o guarda de ciclo, o poll imediato da volta e o timeout do ciclo
    // anterior passariam a reagendar em paralelo, dobrando o custo da aba
    // ociosa a cada alt-tab.
    mockFetchVersion("v1");
    const renderer = await render("v1");

    for (let i = 0; i < 3; i++) {
      documentStub.hidden = true;
      await act(async () => {
        documentStub.dispatch("visibilitychange");
        await vi.advanceTimersByTimeAsync(1_000);
      });
      documentStub.hidden = false;
      await act(async () => {
        documentStub.dispatch("visibilitychange");
        await settle();
      });
    }

    // Três voltas de visibilidade = três polls imediatos, um por volta.
    const callsAfterToggling = fetchCallCount();
    expect(callsAfterToggling).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // Exatamente UM poll no degrau seguinte, não um por ciclo deixado vivo:
    // três alt-tabs teriam deixado três laços reagendando em paralelo.
    expect(fetchCallCount()).toBe(callsAfterToggling + 1);

    act(() => {
      renderer.unmount();
    });
  });
});
