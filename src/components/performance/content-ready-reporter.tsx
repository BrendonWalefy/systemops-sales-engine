"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";

type Props = { surface: PerformanceSurface };

export function ContentReadyReporter({ surface }: Props) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;

    const frame = requestAnimationFrame(() => {
      const durationMs = Math.round(performance.now());
      void fetch("/api/telemetry/performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createContentReadySample(surface, durationMs)),
        keepalive: true,
      }).catch(() => {
        // Telemetria nunca pode quebrar a tela que está medindo.
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [surface]);

  return null;
}
