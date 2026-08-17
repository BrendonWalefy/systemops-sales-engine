import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseCapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import {
  canonicalizeConversationEnginePolicy,
} from "@/application/conversation-v2/engine-selection";
import {
  runAfterSenderDrainAttempt,
} from "@/application/conversation-v2/run-shadow-batch";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { keyedRef } from "@/application/conversation-v2/comparison-record";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";

const style = {
  tone: "neutral",
  verbosity: "concise",
  greeting: "omit",
  emoji: "none",
} as const;

function bookingReads(gateInput: unknown = {
  status: "captured",
  value: {
    automationEnabled: true,
    duplicate: false,
    humanControlled: false,
    optedOut: false,
  },
}) {
  return parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1",
    now: "2026-08-16T12:00:00.000Z",
    gateInput,
    state: { phase: "awaiting_slot", pendingStepId: "offer-private", completedStepIds: [] },
    leadMessage: "mensagem sanitizada",
    history: [],
    policy: {
      priceDisclosureEnabled: true,
      humanEscalationRequired: false,
      schedulingMinimumLeadTimeHours: 2,
      schedulingRequiresEvaluationFirst: false,
    },
    catalog: { status: "captured", value: [] },
    serviceResolutions: [],
    slotSearches: [],
    offeredSlotResolutions: [{
      pendingStepId: "offer-private",
      ordinal: 1,
      date: null,
      time: null,
      result: { id: "slot-private", label: "amanhã às 15h", evidenceRef: "offer-snapshot" },
    }],
    pendingAppointmentResolutions: [],
  });
}

describe("Conversation V2 isolated execution boundary", () => {
  it("isola policy por tenant e rollback para v1 desliga shadow sem revert", () => {
    expect(() => canonicalizeConversationEnginePolicy({
      clinicId: "tenant-b",
      engine: "v1_with_v2_shadow",
      isTest: true,
    }, "tenant-a")).toThrow(/invalid conversation engine policy/);

    expect(canonicalizeConversationEnginePolicy({
      clinicId: "tenant-a", engine: "v1", isTest: true,
    }, "tenant-a")).toEqual({ clinicId: "tenant-a", engine: "v1", isTest: true });
  });

  it("mantém o router livre de writers, booking, outbox e channel adapters", () => {
    const source = readFileSync("src/application/conversation-v2/tenant-engine-router.ts", "utf8");
    expect(source).not.toMatch(/BookingService|CalendarGateway|ChannelAdapter|enqueueOutboundMessage|outbound_messages|infrastructure\//);
  });

  it("shadow intercepta write antes de Capability.execute e não produz texto de sucesso", async () => {
    const runner = new V2ShadowRunner({
      understand: async () => ({
        version: UNDERSTANDING_VERSION,
        request: "confirm-slot",
        dialogueMove: "answers_pending",
        entities: { ordinal: 1 },
        signals: {},
        safety: {},
        confidence: 1,
        ambiguity: null,
      }),
      hmacKey: "runtime-boundary-key",
      style,
    });
    const result = await runner.run(bookingReads());

    expect(result.status).toBe("simulation_not_executed");
    if (result.status !== "simulation_not_executed") throw new Error("write was not intercepted");
    expect(result.intendedEffects).toEqual([
      expect.objectContaining({ action: "book_slot", kind: "would_have_executed" }),
    ]);
    expect("actionResults" in result).toBe(false);
    expect("response" in result).toBe(false);
  });

  it("falha fechado antes do provider quando a captura obrigatória falta", async () => {
    const understand = vi.fn();
    const runner = new V2ShadowRunner({
      understand,
      hmacKey: "runtime-boundary-key",
      style,
    });

    await expect(runner.run(bookingReads({
      status: "unavailable",
      reason: "not_read_by_v1",
    }))).resolves.toEqual({
      status: "unsupported",
      reason: "shared_read_unavailable",
    });
    expect(understand).not.toHaveBeenCalled();
  });

  it("só admite shadow depois do settlement da tentativa do sender", async () => {
    const events: string[] = [];
    let resolveSender!: (value: string) => void;
    const pendingSender = new Promise<string>((resolve) => {
      resolveSender = resolve;
    });
    const execution = runAfterSenderDrainAttempt({
      turns: [],
      drainSender: async () => {
        events.push("sender:start");
        const value = await pendingSender;
        events.push("sender:settled");
        return value;
      },
      onSenderFailure: vi.fn(),
      occurredAt: () => "2026-08-16T12:00:00.000Z",
      afterAttempt: async () => {
        events.push("shadow:start");
        return "shadow-complete";
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["sender:start"]);
    resolveSender("sender-complete");
    await expect(execution).resolves.toMatchObject({
      senderOutcome: "completed",
      senderResult: "sender-complete",
      shadowResult: "shadow-complete",
    });
    expect(events).toEqual(["sender:start", "sender:settled", "shadow:start"]);
  });

  it("mantém artifacts sem PII, N/denominadores congelados e todos os gates sem autoridade", () => {
    const runManifest = JSON.parse(readFileSync("evals/cycle-i/run-manifest.json", "utf8")) as Record<string, unknown>;
    const measurement = JSON.parse(readFileSync("evals/cycle-i/measurement-status.json", "utf8")) as Record<string, unknown>;
    const gate = JSON.parse(readFileSync("evals/cycle-i/gate-report.json", "utf8")) as {
      authoritySignature: unknown;
      judge: string;
      decision: string;
      criteria: Record<string, { denominator: number; status: string }>;
    };
    const artifacts = { runManifest, measurement, gate };
    const serialized = JSON.stringify(artifacts);
    const keys: string[] = [];
    const collectKeys = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collectKeys);
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        keys.push(key);
        collectKeys(nested);
      }
    };
    collectKeys(artifacts);

    expect(runManifest.runs).toBe(6);
    expect(gate.criteria.protocol_integrity?.denominator).toBe(204);
    expect(gate.criteria.supported_understanding?.denominator).toBe(90);
    expect(gate.criteria.critical_regressions?.denominator).toBe(180);
    expect(Object.values(gate.criteria)).toHaveLength(13);
    expect(Object.values(gate.criteria).every(({ status }) => status === "not_measurable")).toBe(true);
    expect(gate.judge).toBe("experimental_non_gating");
    expect(gate.criteria.full_turn_cost?.status).toBe("not_measurable");
    expect(gate.criteria.full_turn_p95?.status).toBe("not_measurable");
    expect(gate.authoritySignature).toBeNull();
    expect(gate.decision).toBe("NO_GO");
    expect(measurement).toMatchObject({ attemptedObservations: 0, resultArtifact: null, humanReviewSheetArtifact: null });
    expect(keys).not.toEqual(expect.arrayContaining([
      "leadMessage",
      "history",
      "prompt",
      "responseText",
      "phone",
      "email",
      "url",
      "turnId",
      "conversationId",
      "providerPayload",
      "evidenceRef",
    ]));
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\//i);
  });

  it("usa HMAC opaco para correlação sem preservar o identificador bruto", () => {
    const raw = "tenant-a:conversation-private:turn-private";
    const reference = keyedRef(raw, "runtime-boundary-key");

    expect(reference).toMatch(/^hmac:[a-f0-9]{64}$/);
    expect(reference).not.toContain(raw);
    expect(reference).not.toContain("conversation-private");
  });
});
