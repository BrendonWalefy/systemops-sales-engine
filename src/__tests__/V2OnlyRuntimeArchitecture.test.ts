import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConversationV2Runtime,
  V2LiveProviderConfigurationError,
} from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

const PROJECT_ROOT = process.cwd();
const PRODUCTION_ROOTS = [
  "src/app/api/cron/message-worker/route.ts",
  "src/app/api/cron/sender-worker/route.ts",
  "src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts",
] as const;

const FORBIDDEN_RUNTIME_MODULES = [
  "/core/pipeline/ConversationOrchestrator",
  "/conversation-v2/tenant-engine-router",
  "/ports/conversation-engine-policy-reader",
  "/repositories/drizzle-conversation-engine-policy-reader",
  "/conversation-v2/internal-lab-approval",
  "/conversation-v2/internal-lab-authorization",
  "/conversation-v2/internal-lab-delivery-guard",
  "/conversation-v2/internal-lab-live-turn-configuration",
  "/conversation-v2/internal-lab-runtime-bindings",
  "/conversation-v2/configured-internal-lab-authority",
  "/conversation-v2/v1-observation-collector",
  "/conversation-v2/v2-shadow-runner",
  "/conversation-v2/run-shadow-batch",
] as const;

// Explicitly authorized replay-only adapter. Its signed synthetic run is not a
// live runtime authorization source and cannot select or deliver to a real
// destination; Task 7 keeps this quality harness disconnected from live roots.
const NON_LIVE_BOUNDARIES = new Set([
  "@/application/labs/internal-lab-synthetic-delivery",
]);

function localImportSpecifiers(source: string): readonly string[] {
  const imports = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?!type\b)[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier?.startsWith("@/") || specifier?.startsWith(".")) {
        imports.add(specifier);
      }
    }
  }
  return [...imports];
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(PROJECT_ROOT, "src", specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) =>
    existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function reachableProductionFiles(): readonly string[] {
  const pending = PRODUCTION_ROOTS.map((root) => resolve(PROJECT_ROOT, root));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of localImportSpecifiers(source)) {
      if (NON_LIVE_BOUNDARIES.has(specifier)) continue;
      const imported = resolveLocalImport(file, specifier);
      if (imported && !visited.has(imported)) pending.push(imported);
    }
  }
  return [...visited];
}

describe("V2-only production runtime architecture", () => {
  it("keeps V1, engine selection, shadow and Internal Lab approval unreachable", () => {
    const reachable = reachableProductionFiles();
    const violations = reachable.flatMap((file) => {
      const relative = file.slice(PROJECT_ROOT.length).replaceAll("\\", "/");
      return FORBIDDEN_RUNTIME_MODULES
        .filter((forbidden) => relative.includes(forbidden))
        .map((forbidden) => `${forbidden} via ${relative}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps webhook ingress free from runtime selection", () => {
    for (const file of [
      "src/app/api/whatsapp/zapi/route.ts",
      "src/app/api/whatsapp/webhook/route.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/TenantEngineRouter|conversation-engine-policy|v1_with_v2_shadow|v2_internal/);
    }
  });

  it("exposes only the worker V2 dependencies", () => {
    const handler = { handle: async () => ({ replied: false as const }) };
    const runtime = createConversationV2Runtime({
      env: {},
      v2Handler: handler,
      clinicFactsReader: { getAutomationFacts: async () => null },
      conversationAuthorityStore: { getVersion: async () => 0 },
      conversationRuntimeControlStore: {
        getGlobal: async () => ({ liveOutboundEnabled: false, version: 0 }),
      },
    });

    expect(Object.keys(runtime).sort()).toEqual([
      "automationPolicy",
      "conversationHandler",
      "decisionTraceSink",
    ]);
    expect(runtime.conversationHandler).toBe(handler);
  });

  it("fails closed with a typed V2 provider error when OpenAI is absent", async () => {
    const runtime = createConversationV2Runtime({
      env: {},
      clinicFactsReader: { getAutomationFacts: async () => null },
      conversationAuthorityStore: { getVersion: async () => 0 },
      conversationRuntimeControlStore: {
        getGlobal: async () => ({ liveOutboundEnabled: false, version: 0 }),
      },
    });

    await expect(runtime.conversationHandler.handle({} as never)).rejects.toEqual(
      expect.objectContaining({
        name: V2LiveProviderConfigurationError.name,
        code: "v2_understanding_provider_unavailable",
      }),
    );
  });
});
