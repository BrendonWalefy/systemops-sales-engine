import { describe, expect, it } from "vitest";
import { loadCorpus } from "@/application/corpus/corpus-index";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { dentalPack, type DentalRequest } from "@/domain-packs/dental";

describe("cobertura de ownership do recorte dental", () => {
  it("cada caso suportado possui exatamente uma capability de negócio", () => {
    const manifest = loadCycleFAcceptanceManifest("evals/understanding/cycle-f-dental.json");
    const byId = new Map(loadCorpus("evals/corpus").cases.map((corpusCase) => [corpusCase.caseId, corpusCase]));
    const owned = manifest.cases.map(({ caseId }) => {
      const label = byId.get(caseId)!.labels.understanding;
      const understanding: Understanding<DentalRequest> = {
        version: UNDERSTANDING_VERSION,
        request: label.request as DentalRequest,
        dialogueMove: label.dialogueMove,
        entities: label.entities,
        signals: label.signals,
        safety: label.safety,
        confidence: 1,
        ambiguity: label.ambiguity,
      };
      const state = {
        phase: "active",
        pendingStepId: label.dialogueMove === "answers_pending" ? `pending:${caseId}` : null,
        completedStepIds: [],
      };
      return dentalPack.capabilities.filter((capability) => capability.claim(understanding, state)).map(({ id }) => id);
    });

    expect(owned).toHaveLength(17);
    expect(owned.every((capabilityIds) => capabilityIds.length === 1)).toBe(true);
  });
});
