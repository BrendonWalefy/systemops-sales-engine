import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";

const corpusRoot = "evals/corpus";

describe("manifesto de aceitação do Ciclo F", () => {
  it("carrega apenas o recorte dental explícito e referencialmente íntegro", () => {
    const manifest = loadCycleFAcceptanceManifest(
      "evals/understanding/cycle-f-dental.json",
      corpusRoot,
    );

    expect(manifest.population).toBe("cycle-f-supported-dental-corpus");
    expect(manifest.cases).toHaveLength(17);
    expect(new Set(manifest.cases.map(({ caseId }) => caseId)).size).toBe(17);
    expect(manifest.exclusions.length).toBeGreaterThan(0);
  });

  it.each([
    ["duplicate", [{ caseId: "price-0001", requiredAxes: ["request"], critical: true }, { caseId: "price-0001", requiredAxes: ["request"], critical: true }]],
    ["missing", [{ caseId: "price-9999", requiredAxes: ["request"], critical: true }]],
    ["empty axes", [{ caseId: "price-0001", requiredAxes: [], critical: true }]],
    ["non dental", [{ caseId: "availability-0002", requiredAxes: ["request"], critical: true }]],
  ])("rejeita caso %s", (_label, cases) => {
    const directory = mkdtempSync(join(tmpdir(), "cycle-f-manifest-"));
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: "cycle-f-dental.v1",
      population: "cycle-f-supported-dental-corpus",
      cases,
      exclusions: [{ requests: ["unsupported"], reason: "out of scope" }],
    }));

    expect(() => loadCycleFAcceptanceManifest(manifestPath, corpusRoot)).toThrow();
  });
});
