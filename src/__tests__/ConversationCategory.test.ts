import { describe, expect, it } from "vitest";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";

describe("ConversationCategory", () => {
  it("mantém automação comercial apenas para categoria sales", () => {
    expect(isSalesConversationCategory("sales")).toBe(true);
    expect(isSalesConversationCategory("operational")).toBe(false);
    expect(isSalesConversationCategory("vendor")).toBe(false);
    expect(isSalesConversationCategory("spam")).toBe(false);
    expect(isSalesConversationCategory("archived")).toBe(false);
  });

  it("trata categoria ausente como sales por compatibilidade", () => {
    expect(isSalesConversationCategory(null)).toBe(true);
    expect(isSalesConversationCategory(undefined)).toBe(true);
  });
});
