"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

const FORCED_REFRESH_INTERVAL_MS = 60_000;
const POLL_INTERVAL_MS = 5_000;

type Props = {
  initialVersion: string;
};

export function InboxPoller({ initialVersion }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const versionRef = useRef(initialVersion);
  const refreshAtRef = useRef(0);

  useEffect(() => {
    versionRef.current = initialVersion;
    refreshAtRef.current = Date.now();
  }, [initialVersion]);

  const refreshInbox = () => {
    refreshAtRef.current = Date.now();
    startTransition(() => {
      router.refresh();
    });
  };

  useEffect(() => {
    const check = async () => {
      if (document.hidden) return;

      if (Date.now() - refreshAtRef.current >= FORCED_REFRESH_INTERVAL_MS) {
        refreshInbox();
        return;
      }

      try {
        const response = await fetch("/api/inbox/check", { cache: "no-store" });
        if (!response.ok) return;
        const data: { version?: string } = await response.json();
        if (data.version && data.version !== versionRef.current) {
          versionRef.current = data.version;
          refreshInbox();
        }
      } catch {
        // Ignora falhas transitórias e tenta novamente no próximo ciclo.
      }
    };

    void check();
    const id = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
