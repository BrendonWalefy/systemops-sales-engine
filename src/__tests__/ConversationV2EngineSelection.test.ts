import { describe, expect, it } from "vitest";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import {
  CONVERSATION_ENGINES,
  resolveConversationEngine,
  type ConversationEngine,
  type ConversationEnginePolicy,
} from "@/application/conversation-v2/engine-selection";
import type { InternalV2ActivationApproval } from "@/application/conversation-v2/activation-approval";

const automationModes: ClinicAutomationMode[] = ["disabled", "observe", "live"];
const approvals = [null, {} as InternalV2ActivationApproval] as const;

describe("Cycle I conversation engine selection", () => {
  it("keeps the engine vocabulary closed", () => {
    expect(CONVERSATION_ENGINES).toEqual(["v1", "v1_with_v2_shadow", "v2_internal"]);
  });

  it.each(
    automationModes.flatMap((automationMode) =>
      CONVERSATION_ENGINES.flatMap((engine) =>
        [false, true].flatMap((isTest) =>
          approvals.map((approval) => ({ automationMode, engine, isTest, approval })),
        ),
      ),
    ),
  )("fails closed for the full automation×engine×isTest×approval matrix: %o", (row) => {
    const policy: ConversationEnginePolicy = {
      clinicId: "clinic-1",
      engine: row.engine as ConversationEngine,
      isTest: row.isTest,
    };
    const result = resolveConversationEngine({
      automationMode: row.automationMode,
      policy,
      approval: row.approval,
      runtimeIdentity: null,
    });

    if (row.automationMode !== "live") {
      expect(result).toEqual({ route: "v1", shadow: false, reason: "automation_not_live" });
      return;
    }
    if (row.engine === "v1") {
      expect(result).toEqual({ route: "v1", shadow: false, reason: "configured_v1" });
      return;
    }
    if (row.engine === "v1_with_v2_shadow") {
      expect(result).toEqual({ route: "v1", shadow: true, reason: "configured_shadow" });
      return;
    }
    expect(result).toEqual({
      route: "v1",
      shadow: false,
      reason: row.isTest && row.approval !== null
        ? "activation_gate_missing"
        : "activation_gate_missing",
    });
  });
});
