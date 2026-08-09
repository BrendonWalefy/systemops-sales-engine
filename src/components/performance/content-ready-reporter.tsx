"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
  MAX_CLIENT_SAMPLES_PER_SESSION,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";
import {
  NAVIGATION_COUNT_KEY,
  type NavigationStorage,
} from "@/application/observability/navigation-timing";

type Props = { surface: PerformanceSurface };

type EmitDeps = {
  storage: NavigationStorage;
  fetch: typeof globalThis.fetch;
  now(): number;
};

function readSampleCount(storage: NavigationStorage): number {
  const count = Number(storage.getItem(NAVIGATION_COUNT_KEY));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function emitContentReadySample(
  surface: PerformanceSurface,
  deps: EmitDeps,
): void {
  try {
    const count = readSampleCount(deps.storage);
    if (count >= MAX_CLIENT_SAMPLES_PER_SESSION) return;
    deps.storage.setItem(NAVIGATION_COUNT_KEY, String(count + 1));

    const durationMs = Math.round(deps.now());
    void deps.fetch("/api/telemetry/performance", {
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
}

export function ContentReadyReporter({ surface }: Props) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;

    const frame = requestAnimationFrame(() => {
      emitContentReadySample(surface, {
        storage: window.sessionStorage,
        fetch: globalThis.fetch,
        now: () => performance.now(),
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [surface]);

  return null;
}
