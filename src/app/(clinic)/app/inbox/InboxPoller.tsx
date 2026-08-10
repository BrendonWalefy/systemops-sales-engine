"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nextPollDelayMs } from "./poll-schedule";

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
    // sempre que a versão muda; nunca é resetada por tempo (não existe mais
    // refresh forçado).
    let consecutiveUnchanged = 0;

    const scheduleNext = () => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        void runPoll();
      }, nextPollDelayMs(consecutiveUnchanged));
    };

    const runPoll = async () => {
      if (cancelled) return;

      if (!document.hidden) {
        try {
          const response = await fetch("/api/inbox/check", { cache: "no-store" });
          if (response.ok) {
            const data: { version?: string } = await response.json();
            if (data.version && data.version !== versionRef.current) {
              versionRef.current = data.version;
              consecutiveUnchanged = 0;
              startTransition(() => {
                router.refresh();
              });
            } else {
              consecutiveUnchanged += 1;
            }
          }
        } catch {
          // Ignora falhas transitórias e tenta novamente no próximo ciclo.
        }
      }

      scheduleNext();
    };

    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
