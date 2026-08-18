import { describe, expectTypeOf, it } from "vitest";
import type {
  CapabilityClaim,
  CapabilityContext,
} from "@/conversation-core/capability/contract";

describe("contrato de capability", () => {
  it("preserva o payload de domínio no tipo do claim", () => {
    type CatalogClaim = CapabilityClaim<{
      kind: "catalog";
      serviceId: string;
    }>;

    expectTypeOf<CatalogClaim["payload"]>().toEqualTypeOf<
      Readonly<{
        kind: "catalog";
        serviceId: string;
      }>
    >();
    expectTypeOf<CatalogClaim>().not.toHaveProperty("attributes");

    // Deliberate adversarial input: untyped payloads must close the boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnyClaimIsRejected = [CapabilityClaim<any>] extends [never]
      ? true
      : false;
    expectTypeOf<AnyClaimIsRejected>().toEqualTypeOf<true>();
  });

  it("expõe somente estado, política estruturada e relógio", () => {
    expectTypeOf<keyof CapabilityContext>().toEqualTypeOf<
      "state" | "policy" | "now"
    >();
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

  it("recusa texto livre escondido dentro da política", () => {
    type UnsafeContext = CapabilityContext<{ leadMessage: string }>;
    type LiteralProseContext = CapabilityContext<{
      instruction: "reinterpret this";
    }>;

    expectTypeOf<
      UnsafeContext["policy"]["leadMessage"]
    >().toEqualTypeOf<never>();
    expectTypeOf<
      LiteralProseContext["policy"]["instruction"]
    >().toEqualTypeOf<never>();
    // Deliberate adversarial input: the boundary must reject an untyped adapter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type AnyIsRejected = [CapabilityContext<any>] extends [never]
      ? true
      : false;
    expectTypeOf<AnyIsRejected>().toEqualTypeOf<true>();
  });
});
