import { describe, expect, it } from "vitest";
import { RESPONSE_VALIDATED_MODEL_IDS } from "@/application/labs/systemops-lab-evidence";
import { LIVE_RESPONSE_VERBALIZER_MODEL_IDS } from "@/infrastructure/adapters/ai/live-response-verbalizer";

describe("vocabulário de modelo do estágio response.validated", () => {
  it("aceita toda identidade que o verbalizador vivo pode declarar", () => {
    const accepted = new Set<string>(RESPONSE_VALIDATED_MODEL_IDS);

    expect(LIVE_RESPONSE_VERBALIZER_MODEL_IDS.filter((id) => !accepted.has(id))).toEqual([]);
  });

  it("aceita os dois valores determinísticos que o handler emite quando o modelo não fala", () => {
    const accepted = new Set<string>(RESPONSE_VALIDATED_MODEL_IDS);

    expect(["deterministic-v2", "deterministic-fallback"].filter((id) => !accepted.has(id)))
      .toEqual([]);
  });
});
