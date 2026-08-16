import { describe, expectTypeOf, it } from "vitest";
import type { CapabilityContext } from "@/conversation-core/capability/contract";

describe("contrato de capability", () => {
  it("expõe somente estado, política estruturada e relógio", () => {
    expectTypeOf<keyof CapabilityContext>().toEqualTypeOf<"state" | "policy" | "now">();
  });

  it("não expõe nenhum canal conhecido de linguagem livre", () => {
    expectTypeOf<CapabilityContext>().not.toHaveProperty("leadMessage");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("message");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("history");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("text");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("content");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("utterance");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("transcript");
    expectTypeOf<CapabilityContext>().not.toHaveProperty("input");
  });
});
