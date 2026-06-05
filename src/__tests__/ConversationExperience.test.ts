import { describe, expect, it } from "vitest";
import { CONCIERGE_MENU_ITEMS, DEFAULT_MENU_ITEMS } from "@/domain/entities/clinic";
import { shouldShowInitialMenu } from "@/core/pipeline/ConversationOrchestrator";

describe("Conversation experience routing", () => {
  it("menu-first shows menu only for generic first contact", () => {
    expect(shouldShowInitialMenu("menu_first", "greeting")).toBe(true);
    expect(shouldShowInitialMenu("menu_first", "unclear")).toBe(true);
  });

  it("menu-first does not override a clear first-contact intent", () => {
    expect(shouldShowInitialMenu("menu_first", "price_inquiry")).toBe(false);
    expect(shouldShowInitialMenu("menu_first", "book_appointment")).toBe(false);
    expect(shouldShowInitialMenu("menu_first", "general_question")).toBe(false);
  });

  it("concierge never opens first contact with the full menu", () => {
    expect(shouldShowInitialMenu("concierge", "greeting")).toBe(false);
    expect(shouldShowInitialMenu("concierge", "price_inquiry")).toBe(false);
  });

  it("concierge menu labels are patient-intent oriented", () => {
    expect(CONCIERGE_MENU_ITEMS[0]?.label).toContain("Transformar");
    expect(DEFAULT_MENU_ITEMS[0]?.label).toBe("Procedimentos");
  });
});
