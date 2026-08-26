import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConversationV2Runtime,
  V2LiveProviderConfigurationError,
} from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

const PROJECT_ROOT = process.cwd();
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts") || path.endsWith(".tsx")
        ? [path]
        : [];
  });
}

const LIVE_APP_ROOTS = sourceFiles(resolve(PROJECT_ROOT, "src/app"))
  .filter((file) => !file.includes("/api/e2e/replay/"));
const PRODUCTION_ROOTS = [
  ...LIVE_APP_ROOTS,
  resolve(PROJECT_ROOT, "src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts"),
  resolve(PROJECT_ROOT, "src/application/jobs/send-message-job.ts"),
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
  "/application/replay/replay-outbound-capture",
] as const;

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
  const pending = [...PRODUCTION_ROOTS];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of localImportSpecifiers(source)) {
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

  it("keeps live roots free from obsolete engine and build-approval symbols", () => {
    const forbiddenSymbols = [
      "internalLabBinding",
      "internalLabDeliveryGuard",
      "internalLabSyntheticRunAuthorization",
      "engineActivationProof",
      "approvalRegistered",
      "approvalDecision",
      "CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON",
    ] as const;
    const violations = reachableProductionFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const relative = file.slice(PROJECT_ROOT.length).replaceAll("\\", "/");
      return forbiddenSymbols
        .filter((symbol) => source.includes(symbol))
        .map((symbol) => `${symbol} via ${relative}`);
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

  it("keeps every live app route free from executable V1 orchestration", () => {
    const violations = LIVE_APP_ROOTS.filter((file) =>
      localImportSpecifiers(readFileSync(file, "utf8"))
        .some((specifier) => specifier.includes("/core/pipeline/ConversationOrchestrator")));

    expect(violations.map((file) => file.slice(PROJECT_ROOT.length + 1))).toEqual([]);
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
