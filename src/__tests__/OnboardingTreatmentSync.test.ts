import { describe, expect, it } from "vitest";
import { resolveTreatmentIdsToDelete } from "@/application/onboarding/treatment-sync";

describe("resolveTreatmentIdsToDelete", () => {
  it("returns only treatments that disappeared from the incoming payload", () => {
    expect(resolveTreatmentIdsToDelete(["a", "b", "c"], ["b", "c"])).toEqual(["a"]);
  });

  it("returns an empty array when no treatments should be removed", () => {
    expect(resolveTreatmentIdsToDelete(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("returns all existing ids when the incoming payload is empty", () => {
    expect(resolveTreatmentIdsToDelete(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
