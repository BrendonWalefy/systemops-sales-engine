import { describe, expect, it } from "vitest";
import {
  pickDefaultProfessional,
  resolveImportedProfessionalId,
} from "@/application/calendar/import-calendar-events";

type Candidate = {
  id: string;
  name: string;
  isActive: boolean;
};

describe("calendar professional selection", () => {
  it("defaults only when exactly one professional is active", () => {
    const candidates: Candidate[] = [
      { id: "inactive-victor", name: "Dr. Victor", isActive: false },
      { id: "active-only", name: "Dra. Ana", isActive: true },
    ];

    expect(pickDefaultProfessional(candidates)).toBe("active-only");
    expect(pickDefaultProfessional([])).toBeNull();
    expect(
      pickDefaultProfessional([
        ...candidates,
        { id: "active-two", name: "Dr. Bruno", isActive: true },
      ]),
    ).toBeNull();
  });

  it("never selects an inactive professional mentioned in the event", () => {
    const candidates: Candidate[] = [
      { id: "inactive", name: "Dr. Gregorie", isActive: false },
      { id: "active", name: "Dra. Ana", isActive: true },
    ];

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação gregorie",
        candidates,
        existingProfessionalId: null,
      }),
    ).toBe("active");
  });

  it("preserves an existing assignment only while that professional remains active", () => {
    const candidates: Candidate[] = [
      { id: "existing-active", name: "Dr. Gregorie", isActive: true },
      { id: "other-active", name: "Dra. Ana", isActive: true },
    ];

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação",
        candidates,
        existingProfessionalId: "existing-active",
      }),
    ).toBe("existing-active");
  });

  it("reimport replaces an inactive existing professional with the sole active default", () => {
    const candidates: Candidate[] = [
      { id: "existing-inactive", name: "Dr. Gregorie", isActive: false },
      { id: "active-default", name: "Dra. Ana", isActive: true },
    ];

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação",
        candidates,
        existingProfessionalId: "existing-inactive",
      }),
    ).toBe("active-default");
  });

  it("reimport clears an inactive existing professional when no unambiguous active default exists", () => {
    const inactiveExisting: Candidate = {
      id: "existing-inactive",
      name: "Dr. Gregorie",
      isActive: false,
    };

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação",
        candidates: [inactiveExisting],
        existingProfessionalId: inactiveExisting.id,
      }),
    ).toBeNull();

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação",
        candidates: [
          inactiveExisting,
          { id: "active-one", name: "Dra. Ana", isActive: true },
          { id: "active-two", name: "Dr. Bruno", isActive: true },
        ],
        existingProfessionalId: inactiveExisting.id,
      }),
    ).toBeNull();
  });

  it("uses an explicit active mention before an existing active assignment", () => {
    const candidates: Candidate[] = [
      { id: "existing", name: "Dra. Ana", isActive: true },
      { id: "mentioned", name: "Dr. Gregorie", isActive: true },
    ];

    expect(
      resolveImportedProfessionalId({
        summary: "Vilma avaliação gregorie",
        candidates,
        existingProfessionalId: "existing",
      }),
    ).toBe("mentioned");
  });
});
