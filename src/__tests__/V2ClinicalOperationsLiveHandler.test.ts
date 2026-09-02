import { describe, expect, it } from "vitest";
import { resolveV2HandoffReason } from "@/application/conversation-v2/v2-live-conversation-handler";

function result(reason: string) {
  return {
    type: reason.startsWith("patient_")
      ? "patient_presence_handoff"
      : "clinical_operation_handoff",
    semanticClass: "human_action_required",
    origin: { capabilityId: "dental-operations" },
    subject: null,
    evidence: [],
    facts: [{
      key: "operational_handoff_reason",
      value: { kind: "display_text", value: reason },
      subject: null,
      evidence: { source: "derived", reference: `operation:${reason}` },
      disclosure: "internal",
    }],
  } as const;
}

describe("V2 clinical operation handoff mapping", () => {
  it.each([
    ["clinical_urgency_requires_human", "v2_clinical_urgency_requires_human"],
    ["existing_treatment_problem_requires_human", "v2_existing_treatment_problem_requires_human"],
    ["patient_arrival_requires_human", "v2_patient_arrival_requires_human"],
    ["patient_delay_requires_human", "v2_patient_delay_requires_human"],
  ] as const)("maps %s to its exact persisted reason", (reason, expected) => {
    expect(resolveV2HandoffReason([result(reason)] as never)).toBe(expected);
  });

  it("maps evaluation-required without inspecting response text", () => {
    expect(resolveV2HandoffReason([{
      type: "clinical_evaluation_required",
      semanticClass: "human_action_required",
      origin: { capabilityId: "dental-scheduling" },
      subject: { type: "service", id: "svc-1", displayName: "Implante" },
      evidence: [{ source: "read", reference: "treatment:svc-1" }],
      facts: [],
    }] as never)).toBe("v2_clinical_evaluation_requires_human");
  });

  it("fails closed for a malformed or unknown operational reason", () => {
    expect(() => resolveV2HandoffReason([
      result("patient_unknown_requires_human"),
    ] as never)).toThrow("unknown V2 operational handoff reason");
  });
});
