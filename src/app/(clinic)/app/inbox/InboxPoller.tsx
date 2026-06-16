"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5_000;
const FORCED_REFRESH_INTERVAL_MS = 60_000;

type Props = {
  initialSignature: string;
};

export function InboxPoller({ initialSignature }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const signatureRef = useRef(initialSignature);
  const refreshAtRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    signatureRef.current = initialSignature;
    refreshAtRef.current = Date.now();
  }, [initialSignature]);

  useEffect(() => {
    const refreshInbox = () => {
      refreshAtRef.current = Date.now();
      startTransition(() => {
        router.refresh();
      });
    };

    const syncInbox = async () => {
      if (inFlightRef.current || document.hidden) return;
      inFlightRef.current = true;

      try {
        const response = await fetch("/api/inbox/check", { cache: "no-store" });
        if (!response.ok) return;

        const data: { signature?: string } = await response.json();
        if (!data.signature) return;

        if (data.signature !== signatureRef.current) {
          signatureRef.current = data.signature;
          refreshInbox();
          return;
        }

        if (Date.now() - refreshAtRef.current >= FORCED_REFRESH_INTERVAL_MS) {
          refreshInbox();
        }
      } catch {
        // Ignore transient polling failures and retry on next cycle.
      } finally {
        inFlightRef.current = false;
      }
    };

    const onVisible = () => {
      if (!document.hidden) {
        void syncInbox();
      }
    };

    const id = window.setInterval(() => {
      void syncInbox();
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router, startTransition]);

  return null;
}
