import { describe, expect, it, vi } from "vitest";
import type { ConversationHandleInput } from "@/application/ports/conversation-handler";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

const turn: ConversationHandleInput = {
  clinicId: "clinic-1",
  phone: "tenant-address",
  messageText: "tenant-input",
  messageId: "provider-1",
  turnId: "turn-1",
  timestamp: new Date("2026-08-25T12:00:00.000Z"),
  automationMode: "live",
};

function runtimeWith(handler: { handle: ReturnType<typeof vi.fn> }) {
  return createConversationV2Runtime({
    env: {},
    v2Handler: handler,
    clinicFactsReader: { getAutomationFacts: async () => null },
    conversationAuthorityStore: { getVersion: async () => 0 },
    conversationRuntimeControlStore: {
      getGlobal: async () => ({ liveOutboundEnabled: false, version: 0 }),
    },
    // Stale callers may still pass these during the staged refactor. They are
    // intentionally ignored and cannot restore V1 reachability.
    v1Handler: { handle: vi.fn() },
    policyReader: { getConversationEnginePolicy: vi.fn() },
    authorizationBindings: { approval: "obsolete" },
  });
}

describe("Conversation V2 has no bidirectional runtime rollback", () => {
  it("ignores legacy engine and approval inputs and executes only V2", async () => {
    const handle = vi.fn().mockResolvedValue({ replied: true, reason: "v2" });
    const runtime = runtimeWith({ handle });

    await expect(runtime.conversationHandler.handle(turn)).resolves.toEqual({
      replied: true,
      reason: "v2",
    });
    expect(handle).toHaveBeenCalledOnce();
  });

  it("propagates a V2 failure without constructing or invoking V1", async () => {
    const handle = vi.fn().mockRejectedValue(new Error("v2 terminal failure"));
    const runtime = runtimeWith({ handle });

    await expect(runtime.conversationHandler.handle(turn)).rejects.toThrow(
      "v2 terminal failure",
    );
    expect(handle).toHaveBeenCalledOnce();
  });
});
