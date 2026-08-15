// O composer precisa saber o número que o validator cobra dele.
//
// Medido no corpus real (13/08): 45% dos turnos reprovam por `response_too_long`.
// O limite é 280 caracteres para as clínicas em verbosidade `concisa`, mas esse
// número nunca chegava ao prompt — o modelo lia "1 ou 2 frases curtas" e era
// julgado por uma régua numérica que ninguém mostrou a ele.
//
// Pior: a regra de verbosidade terminava autorizando estourar o limite para
// preservar dados autorizados, enquanto o validator matava a resposta por
// estourar. O modelo obedecia a instrução que recebeu e perdia a resposta.

import { describe, expect, it } from "vitest";
import { buildComposerSystemPrompt } from "@/core/intelligence/ResponseComposer";

const prompt = (overrides: Record<string, unknown> = {}) =>
  buildComposerSystemPrompt({
    clinic: {
      name: "Clínica Teste",
      specialty: "odontologia",
      toneOfVoice: null,
      playbook: null,
      commercialPolicy: null,
    },
    conversationHistory: [],
    actionResult: { type: "general_question" },
    timezone: { formatNowForPrompt: () => "13/08/2026 14:00" },
    isFirstMessage: false,
    conversationExperience: "concierge",
    conciergeVerbosity: "concisa",
    maxCharacters: 280,
    ...overrides,
  } as never);

describe("orçamento de caracteres no prompt do composer", () => {
  it("diz ao modelo o número exato que o validator cobra", () => {
    expect(prompt()).toContain("280");
  });

  it("não autoriza estourar o limite — a contradição com o validator sai", () => {
    const texto = prompt();
    expect(texto).not.toContain("mesmo que a resposta fique um pouco maior");
  });

  it("mantém a fidelidade do dado como prioridade dentro do orçamento", () => {
    // Encurtar não pode virar licença para omitir preço autorizado: foi assim
    // que `price_omitted` apareceu em todas as três clínicas.
    expect(prompt().toLowerCase()).toContain("priorize");
  });
});
