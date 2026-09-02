import { createHash } from "node:crypto";
import type { OutboundMessageCategory } from "@/application/ports/outbound-message-store";
import {
  isV2ProactiveAutomationOutboundPayload,
  type AutomationOutboundPayload,
  type ProactiveOutboundAuthorizationKind,
  type V2ProactiveAutomationOutboundPayload,
} from "@/application/jobs/conversation-outbound-payload";

export const PROACTIVE_AUTHORIZATION_KINDS = [
  "follow_up",
  "reminder",
  "campaign",
  "recovery",
  "operational",
] as const satisfies readonly ProactiveOutboundAuthorizationKind[];

export function proactiveCategoryFor(
  kind: ProactiveOutboundAuthorizationKind,
): OutboundMessageCategory {
  return kind;
}

export function proactiveTurnId(logicalActionKey: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(`v2-proactive:${logicalActionKey}`).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildProactiveOutboundPayload(
  input: Omit<AutomationOutboundPayload, "version" | "kind" | "authorizationKind" | "agentMessagePersistence"> &
    Readonly<{
      authorizationKind: ProactiveOutboundAuthorizationKind;
      turnId: string;
    }>,
): V2ProactiveAutomationOutboundPayload {
  return {
    version: 1,
    kind: "automation",
    ...input,
    agentMessagePersistence: "sender",
  };
}

export const isV2ProactiveOutboundPayload = isV2ProactiveAutomationOutboundPayload;
