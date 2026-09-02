import { describe, expect, it } from "vitest";
import {
  createDentalPack,
  DENTAL_OUTCOME_SCHEMA,
} from "@/domain-packs/dental";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

const unavailable = async (): Promise<never> => {
  throw new Error("not used by contract test");
};

describe("dental journey public contract", () => {
  it("registers the closed requests used by journey and deposit turns", () => {
    expect(DENTAL_REQUESTS).toEqual(expect.arrayContaining([
      "start-treatment-journey",
      "continue-treatment-journey",
      "submit-journey-media",
      "submit-deposit-proof",
      "change-pending-deposit",
    ]));
  });

  it("registers the journey capability and its auditable outcomes", () => {
    const pack = createDentalPack({
      knowledgeRead: { resolveBusinessInformation: unavailable },
      playbookKnowledgeRead: {
        resolveDifferentials: unavailable,
        resolveFaq: unavailable,
      },
      catalogRead: { resolveService: unavailable, resolveServices: unavailable },
      commercialRead: {
        resolveService: unavailable,
        resolvePaymentConfiguration: unavailable,
        resolveRegisteredObjection: unavailable,
      },
      schedulingRead: {
        listSlots: unavailable,
        resolveOfferedSlot: unavailable,
        resolvePendingAppointment: unavailable,
      },
      schedulingWrite: {
        persistSlotOffer: unavailable,
        bookSlot: unavailable,
        confirmAppointment: unavailable,
        rescheduleSlot: unavailable,
      },
    });

    expect(pack.capabilities.map(({ id }) => id)).toContain("dental-journey");
    expect(DENTAL_OUTCOME_SCHEMA).toMatchObject({
      journey_step_ready: {
        semanticClass: "information_authorized",
        subjectRequirement: "required",
        evidenceRequirement: "required",
      },
      journey_media_received: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "write_required",
      },
      deposit_requested: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "write_required",
      },
      deposit_proof_received: {
        semanticClass: "effect_completed",
        subjectRequirement: "required",
        evidenceRequirement: "write_required",
      },
    });
  });
});
