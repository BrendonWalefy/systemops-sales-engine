import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDentalUnderstanding } from "@/domain-packs/dental/understanding";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

/**
 * Há dois schemas em série: o JSON schema no boundary do modelo e o Zod logo
 * depois. Quando discordam, o modelo produz uma saída que o próprio sistema
 * recusa — e o turno morre sem que nada no CI acuse. Foi assim que a exigência
 * condicional de `entities.service` derrubou toda saudação em produção.
 */
const adapterSource = readFileSync(
  "src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts",
  "utf8",
);

function accepts(request: string, service: string | null): boolean {
  try {
    parseDentalUnderstanding({
      version: "understanding.v1",
      request,
      dialogueMove: "new_topic",
      entities: { service, date: null, period: null, time: null, serviceCandidates: null, quantity: null, ordinal: null },
      signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
      safety: { optOut: false, requestsHuman: false, emergency: false },
      confidence: 0.9,
      ambiguity: null,
    });
    return true;
  } catch {
    return false;
  }
}

describe("understanding schema agreement", () => {
  it("offers the model at least one request it can satisfy with no service", () => {
    const satisfiable = DENTAL_REQUESTS.filter((request) => accepts(request, null));
    expect(satisfiable.length).toBeGreaterThan(0);
  });

  it("lets the model reach every request the Zod schema accepts", () => {
    // O enum do JSON schema é derivado de DENTAL_REQUESTS; se alguém o fixar à
    // mão, um valor aceito pelo Zod deixa de ser produzível pelo modelo.
    expect(adapterSource).toContain("enum: DENTAL_REQUESTS");
  });

  it("never leaves a request that the model can emit and the parser always rejects", () => {
    const alwaysRejected = DENTAL_REQUESTS.filter((request) =>
      !accepts(request, null) && !accepts(request, "Clareamento dental"));
    expect(alwaysRejected).toEqual([]);
  });

  it("keeps the strict json_schema contract that makes the enum binding real", () => {
    expect(adapterSource).toContain('type: "json_schema"');
    expect(adapterSource).toContain("strict: true");
  });
});
