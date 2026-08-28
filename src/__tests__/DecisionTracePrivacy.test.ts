import { describe, expect, it } from "vitest";
import {
  sanitizeResponseDecisionTraceRecord,
  type DecisionTraceRecord,
} from "@/core/observability/DecisionTrace";

describe("AI contract rejection Decision Trace privacy", () => {
  it("keeps only closed correlation metadata and discards rejected content", () => {
    const privateOutput = "rejected model output with private patient text";
    const sanitized = sanitizeResponseDecisionTraceRecord({
      turnId: "turn-evidence-1",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      stage: "v2.understanding",
      occurredAt: "2026-08-27T03:00:00.000Z",
      metadata: {
        status: "failed",
        durationMs: 18,
        modelId: "gpt-4o-mini",
        request: null,
        errorCode: "output_invalid",
        rejectionStage: "understanding_structural",
        rejectionCodes: "schema_type_mismatch",
        evidenceCaptureStatus: "stored",
        evidenceRef: "opaque-evidence-ref",
        rawOutput: privateOutput,
        errorMessage: privateOutput,
        issueValues: privateOutput,
      },
    } as unknown as DecisionTraceRecord);

    expect(sanitized.metadata).toEqual({
      status: "failed",
      durationMs: 18,
      modelId: "gpt-4o-mini",
      request: null,
      errorCode: "output_invalid",
      rejectionStage: "understanding_structural",
      rejectionCodes: "schema_type_mismatch",
      evidenceCaptureStatus: "stored",
      evidenceRef: "opaque-evidence-ref",
    });
    expect(JSON.stringify(sanitized)).not.toContain(privateOutput);
  });

  it("sanitizes verbalization rejection correlation without rejected prose", () => {
    const privateOutput = "rejected verbalization with private patient text";
    const sanitized = sanitizeResponseDecisionTraceRecord({
      turnId: "turn-evidence-2",
      stage: "response.validated",
      occurredAt: "2026-08-27T03:00:00.000Z",
      metadata: {
        action: "v2_response",
        valid: true,
        violationCount: 0,
        violations: "",
        requiresHandoff: false,
        source: "draft",
        model: "deterministic-fallback",
        promptVersion: "deterministic-renderer.v1",
        verbalizationViolations: "unauthorized_number",
        rejectionStage: "response_verbalization",
        rejectionCodes: "unauthorized_number",
        evidenceCaptureStatus: "stored",
        evidenceRef: "opaque-verbalization-ref",
        responseStrategy: "hybrid_contextual_v1",
        understandingCalls: 1,
        verbalizationCalls: 1,
        rawOutput: privateOutput,
        rejectedText: privateOutput,
        leadMessage: privateOutput,
        conversationBrief: privateOutput,
      },
    } as unknown as DecisionTraceRecord);

    expect(sanitized.metadata).toMatchObject({
      rejectionStage: "response_verbalization",
      rejectionCodes: "unauthorized_number",
      evidenceCaptureStatus: "stored",
      evidenceRef: "opaque-verbalization-ref",
      responseStrategy: "hybrid_contextual_v1",
      understandingCalls: 1,
      verbalizationCalls: 1,
    });
    expect(JSON.stringify(sanitized)).not.toContain(privateOutput);
  });
});
