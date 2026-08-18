import { createDentalCapturedReadAdapters, CapturedReadUnavailableError } from "@/application/conversation-v2/dental-captured-read-adapters";
import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import {
  dentalEffectDecisionIdentity,
  recordDentalIntendedEffect,
  type DentalEffectDecisionIdentity,
  type IntendedEffect,
} from "@/application/conversation-v2/dental-intended-effects";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import type { ComposerStyle, CoreResponse } from "@/conversation-core/composer/contract";
import type { ActionResult } from "@/conversation-core/decision";
import { completeTurnPipeline, prepareTurnPipeline, type PreparedDecision } from "@/conversation-core/turn-pipeline";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  createDentalPack,
  DENTAL_OUTCOME_SCHEMA,
  type DentalRequest,
} from "@/domain-packs/dental";

export type V2ShadowResult =
  | Readonly<{ status: "evaluated"; decisions: readonly PreparedDecision[]; actionResults: readonly ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[]; response: CoreResponse }>
  | Readonly<{ status: "simulation_not_executed"; executeDecisions: readonly DentalEffectDecisionIdentity[]; intendedEffects: readonly IntendedEffect[] }>
  | Readonly<{ status: "unsupported"; reason: "unknown_effect" | "shared_read_unavailable" | "unsupported_request" }>
  | Readonly<{ status: "error"; errorName: string }>;

const shadowWritePort = {
  async persistSlotOffer(): Promise<never> { throw new Error("shadow execution cannot write"); },
  async bookSlot(): Promise<never> { throw new Error("shadow execution cannot write"); },
  async confirmAppointment(): Promise<never> { throw new Error("shadow execution cannot write"); },
};

export class V2ShadowRunner {
  constructor(private readonly deps: {
    understand(reads: CapturedV2TurnReads): Promise<Understanding<DentalRequest>>;
    hmacKey: string;
    style: ComposerStyle;
  }) {}

  async run(
    reads: CapturedV2TurnReads,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<V2ShadowResult> {
    if (reads.gateInput.status !== "captured") return { status: "unsupported", reason: "shared_read_unavailable" };
    try {
      const adapters = createDentalCapturedReadAdapters(reads);
      const pack = createDentalPack({ ...adapters, schedulingWrite: shadowWritePort });
      const preparation = await prepareTurnPipeline({
        gateInput: reads.gateInput.value,
        state: reads.state,
        policy: reads.policy,
        now: new Date(reads.now),
        understand: () => this.deps.understand(reads),
        capabilities: pack.capabilities,
      });
      if (preparation.status !== "prepared") return { status: "unsupported", reason: "unsupported_request" };
      const intendedEffects: IntendedEffect[] = [];
      const executeDecisions: DentalEffectDecisionIdentity[] = [];
      for (const prepared of preparation.prepared.decisions) {
        const intended = recordDentalIntendedEffect({
          capabilityId: prepared.capabilityId,
          decision: prepared.decision,
          hmacKey: this.deps.hmacKey,
        });
        if (!intended) {
          if (prepared.decision.kind === "execute") {
            return { status: "unsupported", reason: "unknown_effect" };
          }
          continue;
        }
        const identity = dentalEffectDecisionIdentity(prepared);
        if (!identity) return { status: "unsupported", reason: "unknown_effect" };
        executeDecisions.push(identity);
        intendedEffects.push(intended);
      }
      if (intendedEffects.length > 0) {
        return {
          status: "simulation_not_executed",
          executeDecisions: Object.freeze(executeDecisions),
          intendedEffects: Object.freeze(intendedEffects),
        };
      }
      const completed = await completeTurnPipeline({
        prepared: preparation.prepared,
        outcomeSchema: pack.outcomeSchema,
        response: { style: this.deps.style, composer: new DeterministicResponseComposer() },
      });
      if (completed.status !== "delivered") return { status: "unsupported", reason: "unsupported_request" };
      return {
        status: "evaluated",
        decisions: preparation.prepared.decisions,
        actionResults: completed.actionResults,
        response: completed.response,
      };
    } catch (error) {
      if (options.signal?.aborted && error === options.signal.reason) throw error;
      if (error instanceof CapturedReadUnavailableError) return { status: "unsupported", reason: "shared_read_unavailable" };
      return { status: "error", errorName: error instanceof Error ? error.name : "Error" };
    }
  }
}
