import { describe, expect, it } from "vitest";
import { contrastKind, selectSample } from "../../scripts/select-corpus-sample";
import type { StratifiedCandidate } from "@/application/corpus/candidate-stratification";

function candidate(
  id: string,
  overrides: Partial<StratifiedCandidate> = {},
): StratifiedCandidate {
  return {
    candidateId: id,
    tenantHash: "7d1f0c2ab9",
    conversationHash: "0a91bb7c31",
    turnIndex: 1,
    capturedAt: "2026-07-18T14:22:00.000Z",
    leadMessage: "qual o valor?",
    history: [],
    aiResponse: null,
    humanResponse: null,
    observedIntent: null,
    mediaKind: null,
    isBurst: false,
    journey: "price",
    ...overrides,
  };
}

describe("seleção da amostra de corpus", () => {
  it("classifica o contraste de cada turno", () => {
    expect(
      contrastKind(candidate("a", { aiResponse: "x", humanResponse: "y" })),
    ).toBe("ai_and_human");
    expect(contrastKind(candidate("b", { humanResponse: "y" }))).toBe(
      "human_only",
    );
    expect(contrastKind(candidate("c", { aiResponse: "x" }))).toBe("ai_only");
    expect(contrastKind(candidate("d"))).toBe("unanswered");
  });

  // Sem rodízio, a cota de uma jornada é consumida inteira pelo contraste mais
  // abundante — e como 48,8% dos turnos reais ficaram sem resposta, a amostra
  // sairia quase toda de conversa que ninguém respondeu.
  it("distribui a cota entre os contrastes em vez de esgotar o primeiro", () => {
    const pool: StratifiedCandidate[] = [
      candidate("both-1", { aiResponse: "x", humanResponse: "y" }),
      candidate("both-2", { aiResponse: "x", humanResponse: "y" }),
      ...Array.from({ length: 20 }, (_, index) =>
        candidate(`silent-${index}`),
      ),
      candidate("human-1", { humanResponse: "y" }),
      candidate("ai-1", { aiResponse: "x" }),
    ];

    const selected = selectSample(pool, { price: 4 });
    const kinds = selected.map(contrastKind).sort();

    expect(kinds).toEqual(["ai_and_human", "ai_only", "human_only", "unanswered"]);
  });

  // Reproduzir a amostra é pré-requisito de comparar baseline: se a seleção
  // muda entre execuções, "o corpus mudou" e "a amostra mudou" viram a mesma
  // coisa e nenhuma medição é comparável.
  it("é determinística para a mesma entrada", () => {
    const pool = Array.from({ length: 30 }, (_, index) =>
      candidate(`c-${index}`, { aiResponse: "x" }),
    );

    const first = selectSample(pool, { price: 5 }).map((e) => e.candidateId);
    const second = selectSample([...pool].reverse(), { price: 5 }).map(
      (e) => e.candidateId,
    );

    expect(first).toEqual(second);
  });

  it("não completa a cota de uma jornada com turno de outra", () => {
    const selected = selectSample(
      [candidate("p1", { aiResponse: "x" }), candidate("m1", { journey: "media", aiResponse: "x" })],
      { price: 5 },
    );

    expect(selected.map((entry) => entry.candidateId)).toEqual(["p1"]);
  });
});
