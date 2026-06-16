"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type RealtimeState = {
  inboxSignature: string | null;
  agendaSignature: string | null;
  connected: boolean;
};

const RealtimeContext = createContext<RealtimeState>({
  inboxSignature: null,
  agendaSignature: null,
  connected: false,
});

export function useRealtimeEvents(): RealtimeState {
  return useContext(RealtimeContext);
}

const RECONNECT_DELAY_MS = 3_000;

export function RealtimeEventsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RealtimeState>({
    inboxSignature: null,
    agendaSignature: null,
    connected: false,
  });

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;

    const connect = () => {
      if (stopped || document.hidden) return;

      source = new EventSource("/api/events/stream");

      source.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
      };

      source.addEventListener("inbox", (event) => {
        const data: { signature?: string } = JSON.parse((event as MessageEvent).data);
        if (data.signature) {
          setState((prev) => ({ ...prev, inboxSignature: data.signature ?? prev.inboxSignature }));
        }
      });

      source.addEventListener("agenda", (event) => {
        const data: { signature?: string } = JSON.parse((event as MessageEvent).data);
        if (data.signature) {
          setState((prev) => ({ ...prev, agendaSignature: data.signature ?? prev.agendaSignature }));
        }
      });

      source.onerror = () => {
        source?.close();
        setState((prev) => ({ ...prev, connected: false }));
        if (!stopped) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    // Fecha a conexão quando a aba some de vista — sem isso o stream fica
    // ligado em segundo plano (até ~270s) mantendo o compute do Neon acordado
    // sem necessidade. Reconecta quando a aba volta a ficar visível.
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        source?.close();
        source = null;
        setState((prev) => ({ ...prev, connected: false }));
        return;
      }

      if (!source || source.readyState === EventSource.CLOSED) {
        connect();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      stopped = true;
      source?.close();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}
