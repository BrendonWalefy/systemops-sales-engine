export const PERFORMANCE_SCHEMA_VERSION = 1 as const;
export const MAX_CLIENT_SAMPLES_PER_SESSION = 30;

export const PERFORMANCE_SURFACES = [
  "clinic_shell",
  "inbox_list",
  "conversation",
  "agenda",
  "dashboard",
] as const;

export const PERFORMANCE_OPERATIONS = [
  "shell_context",
  "inbox_base_query",
  "inbox_enrichment_query",
  "inbox_total",
  "conversation_total",
  "agenda_bootstrap",
  "dashboard_total",
  "soft_navigation",
] as const;

export type PerformanceSurface = typeof PERFORMANCE_SURFACES[number];
export type PerformanceOperation = typeof PERFORMANCE_OPERATIONS[number];

export type PerformanceSample = {
  schemaVersion: 1;
  source: "client" | "server";
  surface: PerformanceSurface;
  operation: PerformanceOperation;
  durationMs: number;
  cacheState?: "cold" | "warm" | "unknown";
  outcome: "ok" | "error";
};

export function createSoftNavigationSample(
  surface: PerformanceSurface,
  durationMs: number,
): PerformanceSample {
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    source: "client",
    surface,
    operation: "soft_navigation",
    durationMs,
    cacheState: "unknown",
    outcome: "ok",
  };
}

export function normalizePerformanceRoute(raw: string): PerformanceSurface | null {
  const { pathname } = new URL(raw, "https://systemops.invalid");

  if (pathname === "/app" || pathname === "/app/") return "clinic_shell";
  if (pathname === "/app/inbox") return "inbox_list";
  if (/^\/app\/inbox\/[^/]+\/?$/.test(pathname)) return "conversation";
  if (pathname === "/app/agenda") return "agenda";
  if (pathname === "/app/dashboard") return "dashboard";

  return null;
}
