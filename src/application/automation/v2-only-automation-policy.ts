import type {
  ClinicAutomationFactsReader,
} from "@/application/ports/clinic-automation-policy-reader";
import type {
  ConversationAuthorityStore,
  ConversationAuthorityVersion,
} from "@/application/ports/conversation-authority-store";
import type {
  ConversationRuntimeControlStore,
} from "@/application/ports/conversation-runtime-control-store";
import { createLogger } from "@/infrastructure/logging/logger";

export type V2AutomationDecision = Readonly<{
  clinicId: string;
  mode: "live" | "observe" | "disabled";
  reason:
    | "live_v2"
    | "clinic_missing"
    | "operational_status"
    | "auto_reply_disabled"
    | "shadow_observe"
    | "demo"
    | "authority_below_v2"
    | "global_kill_switch";
  authorityVersion: ConversationAuthorityVersion;
  runtimeControlVersion: number;
}>;

export type V2AutomationPolicyReadFailure = Readonly<{
  clinicId: string;
  reason: "policy_read_failure";
}>;

export type V2AutomationPolicy = Readonly<{
  decide(clinicId: string): Promise<V2AutomationDecision>;
}>;

type Dependencies = Readonly<{
  clinicFactsReader: ClinicAutomationFactsReader;
  authorityStore: Pick<ConversationAuthorityStore, "getVersion">;
  runtimeControlStore: Pick<ConversationRuntimeControlStore, "getGlobal">;
  onPolicyReadFailure?: (
    failure: V2AutomationPolicyReadFailure,
  ) => void | Promise<void>;
}>;

export class V2OnlyAutomationPolicy implements V2AutomationPolicy {
  constructor(private readonly deps: Dependencies) {}

  async decide(clinicId: string): Promise<V2AutomationDecision> {
    let facts: Awaited<ReturnType<ClinicAutomationFactsReader["getAutomationFacts"]>>;
    let authorityVersion: ConversationAuthorityVersion;
    let runtimeControl: Awaited<ReturnType<ConversationRuntimeControlStore["getGlobal"]>>;

    try {
      [facts, authorityVersion, runtimeControl] = await Promise.all([
        this.deps.clinicFactsReader.getAutomationFacts(clinicId),
        this.deps.authorityStore.getVersion(clinicId),
        this.deps.runtimeControlStore.getGlobal(),
      ]);
    } catch {
      await this.emitPolicyReadFailure(clinicId);
      return decision(clinicId, "disabled", "global_kill_switch", 0, 0);
    }

    if (!facts || facts.clinicId !== clinicId) {
      return decision(
        clinicId,
        "disabled",
        "clinic_missing",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (facts.isDemo) {
      return decision(
        clinicId,
        "disabled",
        "demo",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (facts.operationalStatus !== "active") {
      return decision(
        clinicId,
        "disabled",
        "operational_status",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (!facts.autoReplyEnabled) {
      return decision(
        clinicId,
        "disabled",
        "auto_reply_disabled",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (authorityVersion < 2) {
      return decision(
        clinicId,
        "disabled",
        "authority_below_v2",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (!runtimeControl.liveOutboundEnabled) {
      return decision(
        clinicId,
        "disabled",
        "global_kill_switch",
        authorityVersion,
        runtimeControl.version,
      );
    }
    if (facts.shadowModeEnabled) {
      return decision(
        clinicId,
        "observe",
        "shadow_observe",
        authorityVersion,
        runtimeControl.version,
      );
    }
    return decision(
      clinicId,
      "live",
      "live_v2",
      authorityVersion,
      runtimeControl.version,
    );
  }

  private async emitPolicyReadFailure(clinicId: string): Promise<void> {
    const failure = Object.freeze({
      clinicId,
      reason: "policy_read_failure" as const,
    });
    try {
      if (this.deps.onPolicyReadFailure) {
        await this.deps.onPolicyReadFailure(failure);
        return;
      }
      createLogger({ scope: "V2OnlyAutomationPolicy", clinicId }).warn(
        "automation_policy.read_failed",
        { reason: failure.reason },
      );
    } catch {
      // Policy observability must not reopen a failed read or expose its error.
    }
  }
}

function decision(
  clinicId: string,
  mode: V2AutomationDecision["mode"],
  reason: V2AutomationDecision["reason"],
  authorityVersion: ConversationAuthorityVersion,
  runtimeControlVersion: number,
): V2AutomationDecision {
  return Object.freeze({
    clinicId,
    mode,
    reason,
    authorityVersion,
    runtimeControlVersion,
  });
}
