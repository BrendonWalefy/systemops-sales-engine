import { describe, expect, it } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";

describe("ResponseComposer — conversation experience", () => {
  it("price inquiry context no longer forces menu CTA in concierge mode", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).not.toContain("digite menu");
    expect(ctx).toContain("conduza para a avaliação");
  });

  it("general question context does not reoffer menu for clear questions", () => {
    const ctx = buildActionContext(
      { type: "general_question", clinicContext: "Lead perguntou sobre endereço." },
      "menu_first",
    );

    expect(ctx).not.toContain("digitar *menu*");
    expect(ctx).toContain("Não reapresente menu");
  });
});
