"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeEvents } from "@/components/realtime-events-provider";

const FORCED_REFRESH_INTERVAL_MS = 60_000;
const FALLBACK_POLL_INTERVAL_MS = 15_000;

type Props = {
  initialSignature: string;
};

export function InboxPoller({ initialSignature }: Props) {
  const router = useRouter();
  const { inboxSignature, connected } = useRealtimeEvents();
  const [, startTransition] = useTransition();
  const signatureRef = useRef(initialSignature);
  const refreshAtRef = useRef(0);

  useEffect(() => {
    signatureRef.current = initialSignature;
    refreshAtRef.current = Date.now();
  }, [initialSignature]);

  const refreshInbox = () => {
    refreshAtRef.current = Date.now();
    startTransition(() => {
      router.refresh();
    });
  };

  // Atualização via SSE: assim que o servidor detecta mudança, refaz o RSC.
  useEffect(() => {
    if (!inboxSignature || inboxSignature === signatureRef.current) return;
    signatureRef.current = inboxSignature;
    refreshInbox();
  }, [inboxSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: força refresh a cada 60s mesmo sem mudança (estados dependentes
  // da passagem do tempo) e faz um poll leve se a conexão SSE estiver caída.
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;

      if (Date.now() - refreshAtRef.current >= FORCED_REFRESH_INTERVAL_MS) {
        refreshInbox();
        return;
      }

      if (connected) return;

      try {
        const response = await fetch("/api/inbox/check", { cache: "no-store" });
        if (!response.ok) return;
        const data: { signature?: string } = await response.json();
        if (data.signature && data.signature !== signatureRef.current) {
          signatureRef.current = data.signature;
          refreshInbox();
        }
      } catch {
        // Ignora falhas transitórias e tenta novamente no próximo ciclo.
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
