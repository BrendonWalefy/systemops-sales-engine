import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONVERSATION_HISTORY_MESSAGES,
  MAX_CONVERSATION_HISTORY_MESSAGES,
  MIN_CONVERSATION_HISTORY_MESSAGES,
  resolveConversationHistoryWindow,
  takeRecentConversationHistory,
} from "@/core/intelligence/ConversationHistoryWindow";

describe("ConversationHistoryWindow", () => {
  it("uses the code default when the tenant has no override", () => {
    expect(resolveConversationHistoryWindow(null)).toBe(
      DEFAULT_CONVERSATION_HISTORY_MESSAGES,
    );
  });

  it("bounds malformed or unsafe tenant values", () => {
    expect(resolveConversationHistoryWindow(1)).toBe(
      MIN_CONVERSATION_HISTORY_MESSAGES,
    );
    expect(resolveConversationHistoryWindow(100)).toBe(
      MAX_CONVERSATION_HISTORY_MESSAGES,
    );
    expect(resolveConversationHistoryWindow(12.9)).toBe(12);
    expect(resolveConversationHistoryWindow(Number.NaN)).toBe(
      DEFAULT_CONVERSATION_HISTORY_MESSAGES,
    );
  });

  it("returns only the most recent configured messages", () => {
    expect(takeRecentConversationHistory([1, 2, 3, 4, 5, 6], 4)).toEqual([
      3, 4, 5, 6,
    ]);
  });
});
