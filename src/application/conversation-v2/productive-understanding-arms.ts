import OpenAI from "openai";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadCorpus } from "@/application/corpus/corpus-index";
import type { Message } from "@/domain/entities/conversation";
import { IntentClassifier } from "@/core/intelligence/IntentClassifier";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";
import type { CycleIUnderstandingArm } from "@/application/conversation-v2/corpus-comparison-runner";
import type { ModelCallSummary } from "@/application/conversation-v2/comparison-record";
import {
  isRegisteredAuthorizedCycleIRunManifest,
  type AuthorizedCycleIRunManifest,
} from "@/application/conversation-v2/run-manifest-authority";

const registry = new WeakMap<object, AuthorizedCycleIRunManifest>();
const configSchema = z.object({
  services: z.array(z.object({ name: z.string().min(1) }).passthrough()),
}).passthrough();
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)])); return value; }
function digest(value: string, domain: string): `hmac:${string}` { return `hmac:${createHmac("sha256", domain).update(value).digest("hex")}`; }

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return Object.freeze(value);
}

function messages(
  caseId: string,
  fixedNow: string,
  history: readonly Readonly<{ author: "lead" | "agent" | "operator"; body: string }>[],
): Message[] {
  return history.map((entry, index) => ({
    id: `${caseId}-history-${index}`, conversationId: caseId,
    author: entry.author === "lead" ? "lead" : "clinic_user",
    body: entry.body, sentAt: new Date(fixedNow), externalId: null,
  })) as Message[];
}

function summary(modelId: string, latencyMs: number): ModelCallSummary {
  return freeze({ modelId, calls: 1, inputTokens: null, outputTokens: null,
    latencyMs: Math.max(0, Math.round(latencyMs)), estimatedCostMinor: null });
}

export function createProductiveCycleIUnderstandingArms(input: Readonly<{
  manifest: AuthorizedCycleIRunManifest;
  apiKey: string;
}>): Readonly<{ v1: CycleIUnderstandingArm; v2: CycleIUnderstandingArm }> {
  if (!isRegisteredAuthorizedCycleIRunManifest(input.manifest)) {
    throw new Error("productive Understanding arms require an authorized run manifest");
  }
  if (!input.apiKey.trim()) throw new Error("productive Understanding arms require an API key");
  const actualV1ModelId = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini";
  if (actualV1ModelId !== input.manifest.v1.modelId) {
    throw new Error("IntentClassifier model is outside the authorized run manifest");
  }
  const v1Source = readFileSync("src/core/intelligence/IntentClassifier.ts", "utf8");
  const v2Source = [
    readFileSync("src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts", "utf8"),
    readFileSync("src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts", "utf8"),
  ].join("\0");
  if (
    digest(v1Source, "cycle-i-v1-prompt-source.v1") !== input.manifest.v1.promptDigest
    || digest(v2Source, "cycle-i-v2-prompt-source.v1") !== input.manifest.v2.promptDigest
  ) throw new Error("productive prompt/adapter source differs from the authorized run manifest");
  const corpus = loadCorpus(input.manifest.corpusRoot);
  const configByCase = new Map(corpus.cases.map((entry) => {
    const parsed = configSchema.parse(JSON.parse(readFileSync(
      `${input.manifest.corpusRoot}/tenant-configs/${entry.input.tenantConfigRef}.json`,
      "utf8",
    )));
    return [entry.caseId, freeze(parsed)] as const;
  }));
  const tenantConfigDigest = digest(JSON.stringify(canonical([...configByCase.entries()])), "cycle-i-tenant-configs.v1");
  if (tenantConfigDigest !== input.manifest.tenantConfigDigest) {
    throw new Error("tenant fixtures differ from the authorized run manifest");
  }
  const classifier = new IntentClassifier();
  const provider = new DentalUnderstandingProvider(new OpenAIDentalUnderstandingModel(
    new OpenAI({ apiKey: input.apiKey, maxRetries: 0 }), input.manifest.v2.modelId,
  ));
  const v1: CycleIUnderstandingArm = freeze({ async runCase(turn) {
    const config = configByCase.get(turn.caseId);
    if (!config) throw new Error("case absent from frozen config snapshot");
    const started = performance.now();
    const result = await classifier.classify(
      turn.leadMessage,
      messages(turn.caseId, turn.fixedNow, turn.history),
      turn.hasPendingSlotOffer,
      config.services.map((service) => ({ name: service.name, aliases: [] })),
    );
    return freeze({ request: result.intent, model: summary(actualV1ModelId, performance.now() - started) });
  } });
  const v2: CycleIUnderstandingArm = freeze({ async runCase(turn) {
    const config = configByCase.get(turn.caseId);
    if (!config) throw new Error("case absent from frozen config snapshot");
    const started = performance.now();
    const result = await provider.understand({
      leadMessage: turn.leadMessage,
      history: turn.history.map((entry) => ({ author: entry.author === "lead" ? "lead" as const : "agent" as const, body: entry.body })),
      state: null,
      catalog: config.services.map((service, index) => ({ id: `fixture-service-${index}`, displayName: service.name, aliases: [] })),
    });
    return freeze({ request: result.request, model: summary(input.manifest.v2.modelId, performance.now() - started) });
  } });
  registry.set(v1, input.manifest);
  registry.set(v2, input.manifest);
  return freeze({ v1, v2 });
}

export function isRegisteredProductiveCycleIArms(
  v1: CycleIUnderstandingArm,
  v2: CycleIUnderstandingArm,
  manifest: AuthorizedCycleIRunManifest,
): boolean {
  return registry.get(v1) === manifest && registry.get(v2) === manifest;
}
