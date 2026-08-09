"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
  MAX_CLIENT_SAMPLES_PER_SESSION,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";
import {
  NAVIGATION_COUNT_KEY,
} from "@/application/observability/navigation-timing";

type Props = { surface: PerformanceSurface };

function readSampleCount(storage: Storage): number {
  const count = Number(storage.getItem(NAVIGATION_COUNT_KEY));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function ContentReadyReporter({ surface }: Props) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;

    const frame = requestAnimationFrame(() => {
      try {
        const count = readSampleCount(window.sessionStorage);
        if (count >= MAX_CLIENT_SAMPLES_PER_SESSION) return;
        window.sessionStorage.setItem(NAVIGATION_COUNT_KEY, String(count + 1));

        const durationMs = Math.round(performance.now());
        void fetch("/api/telemetry/performance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(createContentReadySample(surface, durationMs)),
          keepalive: true,
        }).catch(() => {
          // Telemetria nunca pode quebrar a tela que está medindo.
        });
      } catch {
        // Telemetria nunca pode quebrar a tela que está medindo.
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [surface]);

  return null;
}
