import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { OUTCOME_SEMANTIC_CLASSES, defineOutcomeSchema } from "@/conversation-core/decision";

/**
 * O vocabulário vivia copiado no tipo, na validação de schema e na validação de
 * action result. Acrescentar uma classe compilava e falhava só em runtime, no
 * meio do turno — foi assim que a resposta de recepção morreu depois de já estar
 * modelada. Este teste existe para que a cópia não volte.
 */
// `options_found` exige opções por definição estrutural, não por vocabulário;
// o caminho completo dela é coberto pelos testes de agenda.
const withoutStructuralRequirement = OUTCOME_SEMANTIC_CLASSES
  .filter((semanticClass) => semanticClass !== "options_found");

describe("outcome semantic class source", () => {
  it("declares every class in the schema validator", () => {
    for (const semanticClass of OUTCOME_SEMANTIC_CLASSES) {
      expect(() => defineOutcomeSchema({
        probe: { semanticClass, subjectRequirement: "forbidden", evidenceRequirement: "optional" },
      } as never)).not.toThrow();
    }
  });

  it("accepts every class at the action result boundary", () => {
    for (const semanticClass of withoutStructuralRequirement) {
      const schema = defineOutcomeSchema({
        probe: { semanticClass, subjectRequirement: "forbidden", evidenceRequirement: "optional" },
      } as never);
      expect(() => buildV2AuthorizedResponsePlan(schema, [{
        type: "probe",
        semanticClass,
        origin: { capabilityId: "probe-capability" },
        subject: null,
        evidence: [],
        facts: [],
      }] as never)).not.toThrow();
    }
  });

  it("keeps a single literal list in the codebase", () => {
    const literalLists = [
      "src/conversation-core/decision.ts",
      "src/conversation-core/authorized-response-plan.ts",
    ].filter((path) =>
      /"information_authorized",[\s\S]{0,240}"clarification_required"/.test(readFileSync(path, "utf8")));

    expect(literalLists).toEqual(["src/conversation-core/decision.ts"]);
  });
});
