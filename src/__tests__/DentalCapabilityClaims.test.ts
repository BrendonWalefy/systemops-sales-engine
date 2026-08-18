import { describe, expect, expectTypeOf, it } from "vitest";
import type { CapabilityContext } from "@/conversation-core/capability/contract";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  dentalPack,
  type DentalPolicy,
  type DentalRequest,
} from "@/domain-packs/dental";

const understanding = (
  request: "price-of-service" | "book-appointment" | "confirm-slot",
): Understanding<DentalRequest> => ({
  version: UNDERSTANDING_VERSION,
  request,
  dialogueMove: "new_topic" as const,
  entities:
    request === "price-of-service"
      ? { service: "clareamento" }
      : ({} as Record<string, never>),
  signals: {},
  safety: {},
  confidence: 0.9,
  ambiguity: null,
});

describe("claims mínimos do pack dental", () => {
  it("declara ordem e ownership sem resolver ports durante claim", () => {
    expect(dentalPack.capabilities.map(({ id }) => id)).toEqual([
      "dental-catalog",
      "dental-scheduling",
      "dental-escalation",
      "dental-reception",
    ]);
    expect(
      dentalPack.capabilities.map(
        (capability) =>
          capability.claim(understanding("price-of-service"), {
            phase: "active",
            pendingStepId: null,
            completedStepIds: [],
          })?.capabilityId ?? null,
      ),
    ).toEqual(["dental-catalog", null, null, null]);
    const scheduling = dentalPack.capabilities[1]!;
    const claim = scheduling.claim(understanding("book-appointment"), {
      phase: "active",
      pendingStepId: null,
      completedStepIds: [],
    });
    expect(claim?.capabilityId).toBe("dental-scheduling");
    expect(claim?.payload).toEqual({
      kind: "scheduling",
      request: "book-appointment",
      serviceQuery: null,
      requestedDate: null,
      requestedPeriod: null,
    });
  });

  it("mantém o contexto livre de linguagem e providers", () => {
    expectTypeOf<keyof CapabilityContext<DentalPolicy>>().toEqualTypeOf<
      "state" | "policy" | "now"
    >();
  });
});
