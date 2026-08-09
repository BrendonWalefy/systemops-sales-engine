"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MAX_CLIENT_SAMPLES_PER_SESSION } from "@/application/observability/performance-telemetry";
import {
  NAVIGATION_COUNT_KEY,
  consumeNavigationSampleInSession,
  type NavigationStorage,
} from "@/application/observability/navigation-timing";

type NavigationReporterDeps = {
  storage: NavigationStorage;
  now(): number;
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetch: typeof globalThis.fetch;
};

function readSampleCount(storage: NavigationStorage): number {
  const count = Number(storage.getItem(NAVIGATION_COUNT_KEY));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function browserReporterDeps(): NavigationReporterDeps {
  return {
    storage: window.sessionStorage,
    now: () => performance.now(),
    sendBeacon: typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon.bind(navigator)
      : undefined,
    fetch: globalThis.fetch.bind(globalThis),
  };
}

export function reportNavigationCompletion(
  pathname: string,
  deps?: NavigationReporterDeps,
): void {
  try {
    const runtime = deps ?? browserReporterDeps();
    const sample = consumeNavigationSampleInSession(pathname, runtime);
    if (!sample) return;

    const count = readSampleCount(runtime.storage);
    if (count >= MAX_CLIENT_SAMPLES_PER_SESSION) return;
    runtime.storage.setItem(NAVIGATION_COUNT_KEY, String(count + 1));

    const body = new Blob([JSON.stringify(sample)], { type: "application/json" });
    let sent = false;
    if (runtime.sendBeacon) {
      try {
        sent = runtime.sendBeacon("/api/telemetry/performance", body);
      } catch {
        sent = false;
      }
    }
    if (!sent) {
      void runtime.fetch("/api/telemetry/performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Telemetry must never affect navigation.
  }
}

export function NavigationPerformanceReporter({ enabled = false }: { enabled?: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (enabled) reportNavigationCompletion(pathname);
  }, [enabled, pathname]);

  return null;
}
