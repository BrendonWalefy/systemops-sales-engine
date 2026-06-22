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

const POLL_INTERVAL_MS = 5_000;

export function RealtimeEventsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RealtimeState>({
    inboxSignature: null,
    agendaSignature: null,
    connected: false,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const poll = async () => {
      if (stoppedRef.current || document.hidden) return;
      try {
        const res = await fetch("/api/events/stream", { cache: "no-store" });
        if (!res.ok) {
          setState((prev) => ({ ...prev, connected: false }));
          return;
        }
        const data: { inboxSignature?: string; agendaSignature?: string } = await res.json();
        setState((prev) => ({
          inboxSignature: data.inboxSignature ?? prev.inboxSignature,
          agendaSignature: data.agendaSignature ?? prev.agendaSignature,
          connected: true,
        }));
      } catch {
        setState((prev) => ({ ...prev, connected: false }));
      }
    };

    const start = () => {
      if (stoppedRef.current || document.hidden) return;
      if (intervalRef.current) return;
      void poll();
      intervalRef.current = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setState((prev) => ({ ...prev, connected: false }));
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      stoppedRef.current = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, []);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}
