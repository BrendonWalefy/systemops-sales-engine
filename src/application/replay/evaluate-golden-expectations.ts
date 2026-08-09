import type {
  ReplayGoldenExpectationsV1,
} from "@/application/replay/contracts";
import type { ReplayCalendarEffect } from "@/application/replay/replay-calendar-capture";
import type { ReplayOutboundEffect } from "@/application/replay/replay-outbound-capture";
import type { DecisionTraceEventV1 } from "@/core/observability/DecisionTrace";

export type ReplayGoldenCheck = { code: string; passed: boolean };

export function evaluateReplayGoldenExpectations(input: {
  expectations: ReplayGoldenExpectationsV1;
  trace: DecisionTraceEventV1[];
  finalConversation: { aiPaused: boolean; needsAttention: boolean } | null;
  finalState: string | null;
  outboundEffects: ReplayOutboundEffect[];
  calendarEffects: ReplayCalendarEffect[];
}): ReplayGoldenCheck[] {
  const traceStages = new Set(input.trace.map((event) => event.stage));
  const outboundKinds = new Set(input.outboundEffects.map((effect) => effect.kind));
  const { expectations } = input;

  return [
    {
      code: "golden_required_trace_stages",
      passed: expectations.requiredTraceStages.every((stage) => traceStages.has(stage)),
    },
    {
      code: "golden_forbidden_trace_stages",
      passed: expectations.forbiddenTraceStages.every((stage) => !traceStages.has(stage)),
    },
    {
      code: "golden_final_ai_paused",
      passed: expectations.finalConversation.aiPaused === null ||
        input.finalConversation?.aiPaused === expectations.finalConversation.aiPaused,
    },
    {
      code: "golden_final_needs_attention",
      passed: expectations.finalConversation.needsAttention === null ||
        input.finalConversation?.needsAttention === expectations.finalConversation.needsAttention,
    },
    {
      code: "golden_final_state",
      passed: expectations.finalState === null || input.finalState === expectations.finalState,
    },
    {
      code: "golden_outbound_min_effects",
      passed: input.outboundEffects.length >= expectations.outbound.minEffects,
    },
    {
      code: "golden_outbound_max_effects",
      passed: input.outboundEffects.length <= expectations.outbound.maxEffects,
    },
    {
      code: "golden_outbound_required_kinds",
      passed: expectations.outbound.requiredKinds.every((kind) => outboundKinds.has(kind)),
    },
    {
      code: "golden_calendar_max_write_effects",
      passed: input.calendarEffects.length <= expectations.calendar.maxWriteEffects,
    },
  ];
}
