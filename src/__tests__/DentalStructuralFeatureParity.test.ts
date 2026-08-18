import { describe, expect, it, vi } from "vitest";
import { resolveDentalStructuredInput } from "@/domain-packs/dental/structured-input";

describe("controles estruturados do pack dental", () => {
  it("resolve reset, menu fechado e opção pendente sem chamar modelo", () => {
    const model = vi.fn();
    expect(resolveDentalStructuredInput({ kind: "command", command: "/reset" })).toEqual({ type: "reset_requested" });
    expect(resolveDentalStructuredInput({ kind: "menu", selectedId: "prices", allowedIds: ["prices", "schedule"] })).toEqual({ type: "menu_requested", itemId: "prices" });
    expect(resolveDentalStructuredInput({ kind: "pending_option", pendingStepId: "slots", optionId: "slot-2", offeredOptionIds: ["slot-1", "slot-2"] })).toEqual({ type: "pending_option_selected", pendingStepId: "slots", optionId: "slot-2" });
    expect(resolveDentalStructuredInput({ kind: "command", command: "quero resetar" })).toBeNull();
    expect(model).not.toHaveBeenCalled();
  });
});
