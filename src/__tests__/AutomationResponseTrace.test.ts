import { describe, expect, it } from "vitest";
import { recordAutomationResponseTrace } from "@/core/conversation/automation-response-trace";
import type { PlannedResponse } from "@/core/conversation/ConversationResponsePlanner";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";

const LEAD_TEXT = "Oi, João! Sua consulta é quinta-feira às 09:00.";

function planned(overrides: Partial<PlannedResponse> = {}): PlannedResponse {
  return {
    plan: {
      version: "response-plan.v1",
      action: "appointment_reminder_with_confirmation",
      allowedPriceCents: [],
      allowedScheduleFacts: ["quinta-feira, 10/07 às 09:00"],
      allowedMediaIds: [],
      maxQuestions: 1,
      maxCharacters: 600,
      expectedState: "none",
    },
    response: {
      text: LEAD_TEXT,
      parts: [{ type: "text", content: LEAD_TEXT }],
      mediaIds: [],
      model: "gpt-4o-mini",
      promptVersion: "composer-v4",
      inputTokens: 900,
      outputTokens: 45,
    },
    source: "composer",
    violations: [],
    requiresHandoff: false,
    fallbackReason: null,
    composerLatencyMs: 812,
    ...overrides,
  } as PlannedResponse;
}

describe("trace dos caminhos de outbound automatizado", () => {
  it("registra plano, validação e telemetria do turno", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordAutomationResponseTrace(sink, {
      turnId: "reminder:appointment-1",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      planned: planned(),
    });

    const events = sink.getEvents("reminder:appointment-1");
    expect(events.map((event) => event.stage)).toEqual([
      "response.plan_built",
      "response.validated",
    ]);
    expect(events[1]!.metadata).toMatchObject({
      action: "appointment_reminder_with_confirmation",
      valid: true,
      model: "gpt-4o-mini",
      promptVersion: "composer-v4",
      inputTokens: 900,
      outputTokens: 45,
      latencyMs: 812,
    });
    // O plano é observável sem expor o que ele autorizou textualmente.
    expect(events[0]!.metadata).toMatchObject({ allowedScheduleFactCount: 1 });
  });

  it("registra o fallback quando o gerador saiu do plano", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordAutomationResponseTrace(sink, {
      turnId: "recovery:lead-1",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      planned: planned({
        source: "deterministic_fallback",
        violations: ["unauthorized_price"],
        fallbackReason: "response_plan_violation",
      }),
    });

    const events = sink.getEvents("recovery:lead-1");
    expect(events.map((event) => event.stage)).toEqual([
      "response.plan_built",
      "response.validated",
      "response.fallback_applied",
    ]);
    expect(events[1]!.metadata).toMatchObject({
      valid: false,
      violations: "unauthorized_price",
    });
  });

  it("nunca escreve o texto que foi para o lead", async () => {
    const sink = new InMemoryDecisionTraceSink();

    await recordAutomationResponseTrace(sink, {
      turnId: "reminder:appointment-2",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      planned: planned(),
    });

    const serialized = JSON.stringify(sink.getEvents("reminder:appointment-2"));
    expect(serialized).not.toContain(LEAD_TEXT);
    expect(serialized).not.toContain("João");
    // Nem o fato de agenda autorizado, que é dado do paciente.
    expect(serialized).not.toContain("09:00");
  });
});
