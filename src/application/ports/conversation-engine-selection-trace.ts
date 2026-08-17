import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import type {
  ConversationEngine,
  EffectiveConversationEngine,
} from "@/application/conversation-v2/engine-selection";

export type ConversationEngineSelectionTrace = Readonly<{
  turnRef: HmacRef;
  clinicId: string;
  occurredAt: string;
  automationMode: ClinicAutomationMode;
  configuredEngine: ConversationEngine | null;
  effectiveRoute: "v1";
  shadow: boolean;
  reason: EffectiveConversationEngine["reason"] | "policy_unavailable";
}>;

export type ConversationEngineSelectionTraceSink = Readonly<{
  record(trace: ConversationEngineSelectionTrace): void | Promise<void>;
}>;
