import { z } from "zod";

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

const performanceSampleSchema = z
  .object({
    schemaVersion: z.literal(PERFORMANCE_SCHEMA_VERSION),
    source: z.enum(["client", "server"]),
    surface: z.enum(PERFORMANCE_SURFACES),
    operation: z.enum(PERFORMANCE_OPERATIONS),
    durationMs: z.number().finite().min(0).max(120_000),
    cacheState: z.enum(["cold", "warm", "unknown"]).optional(),
    outcome: z.enum(["ok", "error"]),
  })
  .strict();

export function parsePerformanceSample(sample: unknown): PerformanceSample {
  return performanceSampleSchema.parse(sample);
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
