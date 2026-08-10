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

async function render(initialVersion: string): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(InboxPoller, { initialVersion }));
    // Deixa o primeiro setTimeout ser agendado antes de avançar o relógio.
    await vi.advanceTimersByTimeAsync(0);
  });
  return renderer;
}

describe("InboxPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
    (globalThis as unknown as { document: { hidden: boolean } }).document = { hidden: false };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "nunca chama router.refresh() enquanto a versão não muda, mesmo muito além dos " +
      "60s do antigo refresh forçado (regressão: refresh incondicional)",
    async () => {
      mockFetchVersion("v1");
      const renderer = await render("v1");

      // 12 ciclos no teto de 60s = 12 minutos de tab ociosa — bem além da
      // marca de 60s em que o código antigo forçava router.refresh() mesmo
      // sem nenhuma mudança de versão.
      for (let i = 0; i < 12; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
      }

      expect(global.fetch).toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
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
    const fetchCallsBeforeNextTick = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBeforeNextTick + 1);

    act(() => {
      renderer.unmount();
    });
  });

  it("não busca a versão enquanto document.hidden é true", async () => {
    mockFetchVersion("v1");
    const renderer = await render("v1");

    (globalThis as unknown as { document: { hidden: boolean } }).document.hidden = true;
    const callsWhileVisible = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsWhileVisible);
    act(() => {
      renderer.unmount();
    });
  });
});
