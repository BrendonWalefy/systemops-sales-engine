import { describe, expect, it } from "vitest";
import {
  buildConversationTraceSummary,
  type ConversationTraceInputEvent,
} from "@/application/observability/conversation-trace-summary";

function event(
  turnId: string,
  stage: ConversationTraceInputEvent["stage"],
  occurredAt: string,
  sequence: number,
  metadata?: Record<string, string | number | boolean | null>,
): ConversationTraceInputEvent {
  return {
    schemaVersion: "decision-trace.v1",
    turnId,
    stage,
    occurredAt,
    sequence,
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    metadata,
  };
}

describe("conversation trace summary", () => {
  it("resume um turno V2 enviado com decisão, resultado, estratégia e autorização", () => {
    const summary = buildConversationTraceSummary([
      event("turn-1", "ingress.received", "2026-09-02T12:00:00.000Z", 0),
      event("turn-1", "v2.understanding", "2026-09-02T12:00:00.100Z", 1, {
        status: "completed",
        request: "business-information",
      }),
      event("turn-1", "v2.decision", "2026-09-02T12:00:00.200Z", 2, {
        capabilityIds: "dental-knowledge",
        decisionKinds: "answer",
      }),
      event("turn-1", "v2.action_result", "2026-09-02T12:00:00.300Z", 3, {
        outcomeTypes: "business_information_answered",
        semanticClasses: "information_authorized",
      }),
      event("turn-1", "response.validated", "2026-09-02T12:00:00.400Z", 4, {
        valid: true,
        responseStrategy: "verbalized",
      }),
      event("turn-1", "outbound.enqueued", "2026-09-02T12:00:00.500Z", 5, {
        category: "reply",
        authorizationKind: "live_stream_reply",
      }),
      event("turn-1", "delivery.sent", "2026-09-02T12:00:02.000Z", 6),
    ]);

    expect(summary).toMatchObject({
      schemaVersion: "conversation-trace-summary.v1",
      turnCount: 1,
      turns: [{
        turnId: "turn-1",
        status: "sent",
        startedAt: "2026-09-02T12:00:00.000Z",
        completedAt: "2026-09-02T12:00:02.000Z",
        durationMs: 2_000,
        request: "business-information",
        capabilityIds: ["dental-knowledge"],
        decisionKinds: ["answer"],
        outcomeTypes: ["business_information_answered"],
        semanticClasses: ["information_authorized"],
        responseStrategy: "verbalized",
        outboundCategory: "reply",
        authorizationKind: "live_stream_reply",
      }],
    });
    expect(summary.turns[0]?.timeline.map(({ stage }) => stage)).toEqual([
      "ingress.received",
      "v2.understanding",
      "v2.decision",
      "v2.action_result",
      "response.validated",
      "outbound.enqueued",
      "delivery.sent",
    ]);
  });

  it("distingue silêncio intencional, falha e entrega pendente", () => {
    const summary = buildConversationTraceSummary([
      event("ignored", "turn.ignored", "2026-09-02T12:00:03.000Z", 1, {
        reason: "takeover_active",
      }),
      event("failed", "turn.failed", "2026-09-02T12:00:02.000Z", 1, {
        phase: "response",
        reason: "response_validation_failed",
      }),
      event("pending", "outbound.enqueued", "2026-09-02T12:00:01.000Z", 1, {
        category: "reminder",
        authorizationKind: "reminder",
      }),
    ]);

    expect(summary.turns.map(({ turnId, status }) => ({ turnId, status }))).toEqual([
      { turnId: "ignored", status: "ignored" },
      { turnId: "failed", status: "failed" },
      { turnId: "pending", status: "pending_delivery" },
    ]);
    expect(summary.turns[0]?.terminalReason).toBe("takeover_active");
    expect(summary.turns[1]?.failurePhase).toBe("response");
    expect(summary.turns[1]?.terminalReason).toBe("response_validation_failed");
  });

  it("mantém sent como verdade terminal mesmo se houver falha posterior de acknowledgement", () => {
    const summary = buildConversationTraceSummary([
      event("turn-1", "delivery.sent", "2026-09-02T12:00:01.000Z", 1),
      event("turn-1", "turn.failed", "2026-09-02T12:00:02.000Z", 2, {
        phase: "acknowledgement",
      }),
    ]);

    expect(summary.turns[0]?.status).toBe("sent");
  });

  it("ordena por banco/tempo, tolera relógio inválido e não propaga metadata desconhecida", () => {
    const privateSentinel = "telefone-prompt-resposta-privada";
    const summary = buildConversationTraceSummary([
      event("older", "v2.understanding", "invalid", 2, {
        request: "greeting",
        rawOutput: privateSentinel,
      }),
      event("newer", "response.validated", "2026-09-02T12:00:02.000Z", 2, {
        valid: false,
        violations: "unsupported_fact,unauthorized_link",
        rejectionCodes: "schema_mismatch",
        evidenceCaptureStatus: "stored",
        secret: privateSentinel,
      }),
      event("newer", "response.plan_built", "2026-09-02T12:00:01.000Z", 1),
    ]);

    expect(summary.turns.map(({ turnId }) => turnId)).toEqual(["newer", "older"]);
    expect(summary.turns[0]).toMatchObject({
      validationViolations: ["unsupported_fact", "unauthorized_link"],
      rejectionCodes: ["schema_mismatch"],
      evidenceCaptureStatus: "stored",
    });
    expect(summary.turns[1]?.durationMs).toBeNull();
    expect(JSON.stringify(summary)).not.toContain(privateSentinel);
    expect(JSON.stringify(summary)).not.toContain("rawOutput");
    expect(JSON.stringify(summary)).not.toContain("secret");
  });
});
