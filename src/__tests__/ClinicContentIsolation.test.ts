import { describe, expect, it } from "vitest";
import {
  buildMediaClarificationClinicContext,
  buildSelectedTreatmentContext,
} from "@/core/pipeline/ConversationOrchestrator";

describe("clinic content isolation", () => {
  it("não injeta conteúdo Premium/Estratificada de outra clínica no core", () => {
    const context = buildMediaClarificationClinicContext();

    expect(context).toContain("somente fatos presentes");
    expect(context).toContain("Não invente");
    expect(context).not.toContain("uma única resina");
    expect(context).not.toContain("duas resinas");
    expect(context).not.toContain("mais acessível");
  });

  it("o nome do tratamento não contorna isAesthetic=false", () => {
    const context = buildSelectedTreatmentContext(
      {
        index: 1,
        treatmentId: "lentes",
        name: "Lentes estéticas",
        description: null,
        durationMinutes: 60,
        requiresEvaluationFirst: true,
        isAesthetic: false,
      },
      null,
      "concierge",
    );

    expect(context).not.toContain("NÃO ENVIOU FOTO");
  });
});
