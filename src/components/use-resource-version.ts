"use client";

import { useEffect, useEffectEvent, useRef } from "react";

type Options = {
  initialVersion?: string | null;
  intervalMs: number;
  onChange: () => void | Promise<void>;
};

/** Polls a small version endpoint only while its owning screen is active. */
export function useResourceVersion(url: string | null, options: Options): void {
  const versionRef = useRef<string | null>(options.initialVersion ?? null);
  const requestInFlightRef = useRef(false);
  const onChange = useEffectEvent(options.onChange);

  useEffect(() => {
    versionRef.current = options.initialVersion ?? null;
  }, [options.initialVersion, url]);

  useEffect(() => {
    if (!url) return;

    let disposed = false;

    const check = async () => {
      if (disposed || document.hidden || requestInFlightRef.current) return;

      requestInFlightRef.current = true;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok || disposed) return;

        const data: { version?: string; signature?: string } = await response.json();
        const version = data.version ?? data.signature;
        if (!version) return;

        if (versionRef.current === null) {
          versionRef.current = version;
          return;
        }

        if (version !== versionRef.current) {
          versionRef.current = version;
          await onChange();
        }
      } catch {
        // A falha transitória não deve forçar refetch dos dados da tela.
      } finally {
        requestInFlightRef.current = false;
      }
    };

    const onActivity = () => {
      if (!document.hidden) void check();
    };

    void check();
    const interval = window.setInterval(() => void check(), options.intervalMs);
    document.addEventListener("visibilitychange", onActivity);
    window.addEventListener("focus", onActivity);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onActivity);
      window.removeEventListener("focus", onActivity);
    };
  }, [url, options.intervalMs]);
}
