import OpenAI from "openai";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import {
  createShadowTurnCaptureRegistry,
  type ShadowBatchTurn,
  type ShadowEvaluation,
  type ShadowEvaluator,
} from "@/application/conversation-v2/run-shadow-batch";
import {
  V1ObservationCollector,
} from "@/application/conversation-v2/v1-observation-collector";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import type { V1TurnObservationSink } from "@/core/observability/V1TurnObservation";
import { DentalUnderstandingProvider } from "@/infrastructure/adapters/ai/DentalUnderstandingProvider";
import { OpenAIDentalUnderstandingModel } from "@/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel";
import { DrizzleConversationEnginePolicyReader } from "@/infrastructure/repositories/drizzle-conversation-engine-policy-reader";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const style = Object.freeze({
  tone: "neutral",
  verbosity: "concise",
  greeting: "omit",
  emoji: "none",
} as const);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedModels(env: RuntimeEnvironment, v2ModelId: string): readonly string[] {
  const configured = [
    v2ModelId,
    "gpt-4o-mini",
    "gpt-5.5",
    "deterministic-safety",
    "deterministic-fallback",
    env.OPENAI_COMPOSER_MODEL,
    env.OPENAI_COMPOSER_MODEL_DEFAULT,
    env.OPENAI_COMPOSER_MODEL_START,
    env.OPENAI_COMPOSER_MODEL_GROWTH,
    env.OPENAI_COMPOSER_MODEL_SCALE,
    env.OPENAI_COMPOSER_MODEL_ENTERPRISE,
    env.OPENAI_COMPOSER_MODEL_PREMIUM,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return Object.freeze([...new Set(configured.map((value) => value.trim()))]);
}

function createEvaluator(input: {
  env: RuntimeEnvironment;
  hmacKey: string;
  modelId: string;
}): ShadowEvaluator {
  const apiKey = input.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return Object.freeze({
      async evaluate() {
        return Object.freeze({
          result: Object.freeze({ status: "error" as const, errorName: "MissingOpenAIKey" }),
          understandingRequest: null,
          model: null,
        });
      },
    });
  }

  const provider = new DentalUnderstandingProvider(
    new OpenAIDentalUnderstandingModel(new OpenAI({ apiKey }), input.modelId),
  );
  return Object.freeze({
    async evaluate(reads: CapturedV2TurnReads, signal: AbortSignal): Promise<ShadowEvaluation> {
      if (reads.catalog.status !== "captured") {
        return Object.freeze({
          result: Object.freeze({ status: "unsupported" as const, reason: "shared_read_unavailable" as const }),
          understandingRequest: null,
          model: null,
        });
      }
      let understandingRequest: ShadowEvaluation["understandingRequest"] = null;
      const startedAt = Date.now();
      const runner = new V2ShadowRunner({
        hmacKey: input.hmacKey,
        style,
        understand: async (captured) => {
          const understanding = await provider.understand({
            leadMessage: captured.leadMessage,
            history: captured.history,
            state: captured.state,
            catalog: reads.catalog.status === "captured"
              ? reads.catalog.value.map((service) => ({
                  id: service.id,
                  displayName: service.name,
                  aliases: [],
                }))
              : [],
          }, { signal });
          understandingRequest = understanding.request;
          return understanding;
        },
      });
      const result = await runner.run(reads);
      return Object.freeze({
        result,
        understandingRequest,
        model: Object.freeze({
          modelId: input.modelId,
          calls: 1,
          inputTokens: null,
          outputTokens: null,
          latencyMs: Math.max(0, Date.now() - startedAt),
          estimatedCostMinor: null,
        }),
      });
    },
  });
}

export function createConversationV2Runtime(input: {
  env?: RuntimeEnvironment;
  collector?: V1ObservationCollector;
  policyReader?: ConversationEnginePolicyReader;
  comparisonSink?: ConversationV2ComparisonSink;
} = {}) {
  const env = input.env ?? process.env;
  const hmacKey = env.CONVERSATION_V2_COMPARISON_HMAC_KEY?.trim() ?? "";
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim()
    || env.GIT_COMMIT_SHA?.trim()
    || "missing_commit";
  const modelId = env.OPENAI_V2_UNDERSTANDING_MODEL?.trim() || "gpt-4o-mini";
  const modelAllowlist = allowedModels(env, modelId);
  const collector = input.collector ?? new V1ObservationCollector();
  const captureRegistry = createShadowTurnCaptureRegistry();
  const policyReader = input.policyReader ?? new DrizzleConversationEnginePolicyReader();
  const comparisonSink = input.comparisonSink ?? new DrizzleConversationV2ComparisonSink({
    allowedModelIds: modelAllowlist,
  });

  return Object.freeze({
    policyReader,
    sink: comparisonSink,
    evaluator: createEvaluator({ env, hmacKey, modelId }),
    approval: null,
    maxTurns: positiveInteger(env.CONVERSATION_V2_SHADOW_MAX_TURNS, 10),
    deadlineMs: positiveInteger(env.CONVERSATION_V2_SHADOW_DEADLINE_MS, 20_000),
    now: () => Date.now(),
    recordConfig: Object.freeze({
      hmacKey,
      commit,
      datasetDigest: null,
      allowedModelIds: modelAllowlist,
    }),
    createTurnObservationSink(binding: Readonly<{
      turnId: string;
      clinicId: string;
      automationMode: "live";
    }>): V1TurnObservationSink {
      captureRegistry.bindTurn(binding);
      return Object.freeze({
        record(event) {
          collector.record(event);
          if (event.kind === "turn_terminal") collector.complete(event.turnId);
        },
      });
    },
    drainCapturedTurns(): readonly ShadowBatchTurn[] {
      const promoted: ShadowBatchTurn[] = [];
      for (const turn of collector.drain()) {
        try {
          promoted.push(captureRegistry.promote(turn));
        } catch {
          // Observation remains best-effort and cannot affect the V1 result.
        }
      }
      return Object.freeze(promoted);
    },
  });
}
