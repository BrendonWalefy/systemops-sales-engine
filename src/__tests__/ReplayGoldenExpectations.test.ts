import { describe, expect, it } from "vitest";
import type {
  ReplayGoldenExpectationsV1,
} from "@/application/replay/contracts";
import { evaluateReplayGoldenExpectations } from "@/application/replay/evaluate-golden-expectations";
import type { DecisionTraceEventV1, DecisionTraceStage } from "@/core/observability/DecisionTrace";
import type { ReplayCalendarEffect } from "@/application/replay/replay-calendar-capture";
import type { ReplayOutboundEffect } from "@/application/replay/replay-outbound-capture";

const golden = (
  overrides: Partial<ReplayGoldenExpectationsV1> = {},
): ReplayGoldenExpectationsV1 => ({
  schemaVersion: "replay-golden-expectations.v1",
  requiredTraceStages: [],
  forbiddenTraceStages: [],
  finalConversation: { aiPaused: null, needsAttention: null },
  finalState: null,
  outbound: { minEffects: 0, maxEffects: 10, requiredKinds: [] },
  calendar: { maxWriteEffects: 0 },
  ...overrides,
});

const trace = (stage: DecisionTraceStage): DecisionTraceEventV1[] => [{
  schemaVersion: "decision-trace.v1",
  sequence: 0,
  turnId: "turn-1",
  stage,
  occurredAt: "2026-08-09T00:00:00.000Z",
}];

describe("evaluateReplayGoldenExpectations", () => {
  it("falha quando um golden path não passa pela validação de resposta", () => {
    const checks = evaluateReplayGoldenExpectations({
      expectations: golden({ requiredTraceStages: ["response.validated"] }),
      trace: trace("intent.resolved"),
      finalConversation: { aiPaused: false, needsAttention: false },
      finalState: "idle",
      outboundEffects: [{ kind: "text", sequence: 1 } as ReplayOutboundEffect],
      calendarEffects: [] as ReplayCalendarEffect[],
    });

    expect(checks).toContainEqual({
      code: "golden_required_trace_stages",
      passed: false,
    });
  });

  it("emite todos os códigos estáveis sem conteúdo de transcript ou detalhes livres", () => {
    const checks = evaluateReplayGoldenExpectations({
      expectations: golden({
        requiredTraceStages: ["response.validated"],
        forbiddenTraceStages: ["intent.resolved"],
        finalConversation: { aiPaused: true, needsAttention: true },
        finalState: "awaiting_handoff",
        outbound: { minEffects: 2, maxEffects: 0, requiredKinds: ["voice"] },
        calendar: { maxWriteEffects: 0 },
      }),
      trace: trace("intent.resolved"),
      finalConversation: { aiPaused: false, needsAttention: false },
      finalState: "idle",
      outboundEffects: [{ kind: "text", sequence: 1 } as ReplayOutboundEffect],
      calendarEffects: [{ kind: "appointment.create", sequence: 1 } as ReplayCalendarEffect],
    });

    expect(checks).toEqual([
      { code: "golden_required_trace_stages", passed: false },
      { code: "golden_forbidden_trace_stages", passed: false },
      { code: "golden_final_ai_paused", passed: false },
      { code: "golden_final_needs_attention", passed: false },
      { code: "golden_final_state", passed: false },
      { code: "golden_outbound_min_effects", passed: false },
      { code: "golden_outbound_max_effects", passed: false },
      { code: "golden_outbound_required_kinds", passed: false },
      { code: "golden_calendar_max_write_effects", passed: false },
    ]);
    expect(checks.every((check) => Object.keys(check).join(",") === "code,passed"))
      .toBe(true);
  });

  it("aceita as expectativas nulas e efeitos dentro dos limites", () => {
    expect(evaluateReplayGoldenExpectations({
      expectations: golden({
        requiredTraceStages: ["response.validated"],
        forbiddenTraceStages: ["turn.failed"],
        outbound: { minEffects: 1, maxEffects: 1, requiredKinds: ["text"] },
        calendar: { maxWriteEffects: 1 },
      }),
      trace: trace("response.validated"),
      finalConversation: { aiPaused: false, needsAttention: false },
      finalState: "idle",
      outboundEffects: [{ kind: "text", sequence: 1 } as ReplayOutboundEffect],
      calendarEffects: [{ kind: "appointment.create", sequence: 1 } as ReplayCalendarEffect],
    })).toEqual([
      { code: "golden_required_trace_stages", passed: true },
      { code: "golden_forbidden_trace_stages", passed: true },
      { code: "golden_final_ai_paused", passed: true },
      { code: "golden_final_needs_attention", passed: true },
      { code: "golden_final_state", passed: true },
      { code: "golden_outbound_min_effects", passed: true },
      { code: "golden_outbound_max_effects", passed: true },
      { code: "golden_outbound_required_kinds", passed: true },
      { code: "golden_calendar_max_write_effects", passed: true },
    ]);
  });
});
