import { describe, expect, it } from "vitest";
import {
  buildProactiveOutboundPayload,
  isV2ProactiveOutboundPayload,
  proactiveCategoryFor,
  proactiveTurnId,
  PROACTIVE_AUTHORIZATION_KINDS,
} from "@/application/automation/proactive-outbound";
import { isAutomationOutboundPayload } from "@/application/jobs/conversation-outbound-payload";

const IDS = {
  leadId: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000002",
  agentMessageId: "00000000-0000-4000-8000-000000000003",
};

describe("closed V2 proactive outbound envelope", () => {
  it.each(PROACTIVE_AUTHORIZATION_KINDS)("binds %s to its exact category", (kind) => {
    const payload = buildProactiveOutboundPayload({
      authorizationKind: kind,
      turnId: proactiveTurnId(`${kind}:logical-action`),
      to: "opaque-address",
      text: "safe text",
      ...IDS,
    });

    expect(payload).toMatchObject({
      version: 1,
      kind: "automation",
      authorizationKind: kind,
      agentMessagePersistence: "sender",
    });
    expect(proactiveCategoryFor(kind)).toBe(kind);
    expect(isV2ProactiveOutboundPayload(payload)).toBe(true);
    expect(isAutomationOutboundPayload(payload)).toBe(true);
  });

  it("uses a stable opaque turn identity for the logical action", () => {
    expect(proactiveTurnId("followup:42")).toBe(proactiveTurnId("followup:42"));
    expect(proactiveTurnId("followup:42")).not.toBe(proactiveTurnId("followup:43"));
    expect(proactiveTurnId("followup:42")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects incomplete new envelopes while parsing legacy queue rows", () => {
    const legacy = {
      version: 1,
      kind: "automation",
      to: "opaque-address",
      text: "safe text",
      ...IDS,
    } as const;
    expect(isAutomationOutboundPayload(legacy)).toBe(true);
    expect(isV2ProactiveOutboundPayload(legacy)).toBe(false);

    const current = buildProactiveOutboundPayload({
      authorizationKind: "follow_up",
      turnId: proactiveTurnId("followup:42"),
      to: "opaque-address",
      text: "safe text",
      ...IDS,
    });
    expect(isV2ProactiveOutboundPayload({ ...current, authorizationKind: "human_manual" })).toBe(false);
    expect(isV2ProactiveOutboundPayload({ ...current, turnId: "" })).toBe(false);
    expect(isV2ProactiveOutboundPayload({ ...current, agentMessagePersistence: undefined })).toBe(false);
  });
});
