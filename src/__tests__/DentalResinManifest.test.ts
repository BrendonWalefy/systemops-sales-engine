import { describe, expect, it } from "vitest";
import { dentalResinV1 } from "@/application/templates/dental-resin-v1/manifest";
import { validateManifest } from "@/application/templates/validate-manifest";

const FORBIDDEN_CLINICAL_CLAIMS = [
  "não amarela", "nunca mancha", "dura para sempre", "garantia de",
  "melhor que", "superior", "indolor", "sem risco",
];

const CLINIC_SPECIFIC_VOCABULARY = ["simplificada", "estratificada", "premium", "slim"];

describe("dental resin v1 manifest", () => {
  it("passes its own validator", () => {
    expect(validateManifest(dentalResinV1)).toEqual([]);
  });

  it("defines both variants by stable slug", () => {
    expect(dentalResinV1.variants.map((v) => v.slug).sort()).toEqual(["base", "enhanced"]);
  });

  it("never hardcodes a clinic's commercial vocabulary", () => {
    const text = JSON.stringify(dentalResinV1).toLowerCase();
    for (const word of CLINIC_SPECIFIC_VOCABULARY) {
      expect(text).not.toContain(word);
    }
  });

  it("makes no clinical or warranty claim in any authorized response", () => {
    const responses = dentalResinV1.objections.map((o) => o.response.toLowerCase());
    for (const response of responses) {
      for (const claim of FORBIDDEN_CLINICAL_CLAIMS) {
        expect(response).not.toContain(claim);
      }
    }
  });

  it("asks at most one question per authorized response", () => {
    for (const { response } of dentalResinV1.objections) {
      expect((response.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it("covers the objections the real conversations produced", () => {
    const keys = dentalResinV1.objections.map((o) => o.objection.toLowerCase()).join("|");
    for (const topic of ["preço", "durabilidade", "prazo", "parcel"]) {
      expect(keys).toContain(topic);
    }
  });
});
