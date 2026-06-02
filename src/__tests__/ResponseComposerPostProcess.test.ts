import { describe, expect, it } from "vitest";
import { postProcessResponseText, type ActionResult } from "@/core/intelligence/ResponseComposer";

const slotAction: ActionResult = {
  type: "slots_found",
  askedForPreference: false,
  slots: [
    {
      index: 1,
      label: "Terça-feira, 02 de junho, às 8h",
      startsAt: "2026-06-02T11:00:00.000Z",
      endsAt: "2026-06-02T12:00:00.000Z",
    },
  ],
};

describe("postProcessResponseText", () => {
  it("appends menu hint to slot offers", () => {
    const result = postProcessResponseText("Escolha uma opção pelo número.", slotAction);

    expect(result).toContain("Escolha uma opção pelo número.");
    expect(result).toContain("Se quiser voltar ao menu, digite *menu*.");
  });

  it("does not duplicate menu hint when it is already present", () => {
    const text = "Escolha uma opção.\n\nSe quiser voltar ao menu, digite *menu*.";
    const result = postProcessResponseText(text, slotAction);

    expect(result).toBe(text);
  });

  it("does not append menu hint to non-slot actions", () => {
    const result = postProcessResponseText("Tudo certo.", { type: "acknowledgment" });

    expect(result).toBe("Tudo certo.");
  });
});
