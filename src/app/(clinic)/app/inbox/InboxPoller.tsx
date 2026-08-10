"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  nextPollDelayMs,
  shouldForceRefreshAfterHidden,
  shouldForceRefreshAfterUnchangedPolls,
  unchangedStreakAfterForcedRefresh,
} from "./poll-schedule";

type Props = {
  initialVersion: string;
};

export function InboxPoller({ initialVersion }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const versionRef = useRef(initialVersion);

  useEffect(() => {
    versionRef.current = initialVersion;
  }, [initialVersion]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    // Sequência de polls sem mudança — alimenta a escada de backoff. Zera
    // sempre que a versão muda e sempre que a aba volta a ficar visível.
    let consecutiveUnchanged = 0;
    // Cada reinício do laço (volta de visibilidade) avança o ciclo. Um poll
    // do ciclo anterior — por exemplo um fetch que ainda estava no ar — não
    // reagenda nada, senão dois laços passariam a correr em paralelo e a
    // aba ociosa voltaria a pagar o dobro de polls.
    let cycle = 0;
    let hiddenSince: number | null = null;

    const refresh = () => {
      startTransition(() => {
        router.refresh();
      });
    };

    const scheduleNext = (forCycle: number) => {
      if (cancelled || forCycle !== cycle) return;
      timeoutId = setTimeout(() => {
        void runPoll(forCycle);
      }, nextPollDelayMs(consecutiveUnchanged));
    };

    const runPoll = async (forCycle: number) => {
      if (cancelled || forCycle !== cycle) return;

      if (!document.hidden) {
        try {
          const response = await fetch("/api/inbox/check", { cache: "no-store" });
          if (cancelled || forCycle !== cycle) return;
          if (response.ok) {
            const data: { version?: string } = await response.json();
            if (cancelled || forCycle !== cycle) return;
            if (data.version && data.version !== versionRef.current) {
              versionRef.current = data.version;
              consecutiveUnchanged = 0;
              refresh();
            } else {
              consecutiveUnchanged += 1;
              // Teto de obsolescência: transições que não têm escrita nenhuma
              // (hoursWaiting cruzando 2h, um expiresAt vencendo, um
              // agendamento virando passado) nunca mudam a versão, então sem
              // este ramo a tela de uma clínica parada congelaria sem limite.
              if (shouldForceRefreshAfterUnchangedPolls(consecutiveUnchanged)) {
                consecutiveUnchanged = unchangedStreakAfterForcedRefresh();
                refresh();
              }
            }
          }
        } catch {
          // Ignora falhas transitórias e tenta novamente no próximo ciclo.
        }
      }

      scheduleNext(forCycle);
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;

      if (document.hidden) {
        hiddenSince = Date.now();
        return;
      }

      const hiddenMs = hiddenSince === null ? 0 : Date.now() - hiddenSince;
      hiddenSince = null;

      // Volta de aba: não espera o degrau corrente vencer (podia ser 60s de
      // tela velha na cara do operador). Reinicia o ciclo, zera a escada e
      // busca na hora.
      cycle += 1;
      clearTimeout(timeoutId);
      consecutiveUnchanged = 0;
      if (shouldForceRefreshAfterHidden(hiddenMs)) refresh();
      void runPoll(cycle);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNext(cycle);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
