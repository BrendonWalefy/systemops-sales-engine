import { describe, expect, it } from "vitest";
import {
  CONVERSATION_ENGINES,
  canonicalizeConversationEnginePolicy,
} from "@/application/conversation-v2/engine-selection";

describe("Conversation V2 engine configuration", () => {
  it("keeps the configured engine vocabulary closed", () => {
    expect(CONVERSATION_ENGINES).toEqual(["v1", "v1_with_v2_shadow", "v2_internal"]);
  });

  it("canonicalizes an exact tenant policy without selecting a runtime", () => {
    expect(canonicalizeConversationEnginePolicy({
      clinicId: "clinic-1", engine: "v2_internal", isTest: true,
    }, "clinic-1")).toEqual({ clinicId: "clinic-1", engine: "v2_internal", isTest: true });
    expect(() => canonicalizeConversationEnginePolicy({
      clinicId: "clinic-2", engine: "v2_internal", isTest: true,
    }, "clinic-1")).toThrow(/invalid conversation engine policy/i);
  });
});
