import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  guessJourneyForSampling,
  selectStratifiedCandidates,
  type CorpusCandidate,
} from "@/application/corpus/candidate-stratification";

function candidate(
  id: string,
  leadMessage: string,
  overrides: Partial<CorpusCandidate> = {},
): CorpusCandidate {
  return {
    candidateId: id,
    tenantHash: "7d1f0c2ab9",
    conversationHash: "0a91bb7c31",
    turnIndex: 1,
    capturedAt: "2026-07-18T14:22:00.000Z",
    leadMessage,
    history: [],
    aiResponse: null,
    humanResponse: null,
    observedIntent: null,
    mediaKind: null,
    isBurst: false,
    ...overrides,
  };
}

describe("estratificação de candidatos", () => {
  it("agrupa por jornada a partir do texto do lead", () => {
    expect(guessJourneyForSampling(candidate("a", "qual o valor da lente?"))).toBe(
      "price",
    );
    expect(
      guessJourneyForSampling(candidate("b", "qual o endereço de vocês?")),
    ).toBe("location");
    expect(
      guessJourneyForSampling(candidate("c", "tem horário na quinta?")),
    ).toBe("availability");
    expect(
      guessJourneyForSampling(candidate("d", "achei caro demais")),
    ).toBe("objection");
  });

  it("usa o sinal estrutural quando o texto não diz nada", () => {
    expect(
      guessJourneyForSampling(
        candidate("e", "segue a foto", { mediaKind: "image" }),
      ),
    ).toBe("media");
    expect(
      guessJourneyForSampling(candidate("f", "oi", { isBurst: true })),
    ).toBe("burst");
  });

  // Áudio é jornada própria, e não um sub-caso de mídia: a transcrição entra no
  // pipeline por outro caminho e é onde o entendimento pode falhar sozinho.
  it("separa áudio de mídia visual", () => {
    expect(
      guessJourneyForSampling(
        candidate("e2", "[SEM_TEXTO]", { mediaKind: "audio" }),
      ),
    ).toBe("audio");
  });

  // O balde de sobra precisa dizer que é sobra. Chamá-lo de "procedure"
  // fabricaria 2.794 casos de explicação de procedimento que ninguém verificou.
  it("marca como other o turno que nenhuma regra reconheceu", () => {
    expect(
      guessJourneyForSampling(
        candidate("f2", "pode ser", {
          history: [{ author: "agent", body: "Posso te mandar?" }],
        }),
      ),
    ).toBe("other");
  });

  // Rajada e mídia são modalidades, não jornadas. Deixá-las na frente do texto
  // sequestrava a amostra: na primeira extração real, 368 candidatos caíram em
  // "burst" e sobraram 3 em "objection", que é a jornada escassa e a que o
  // programa mais precisa medir.
  it("não deixa a modalidade sequestrar a jornada do turno", () => {
    expect(
      guessJourneyForSampling(
        candidate("g", "e quanto fica a lente?", { isBurst: true }),
      ),
    ).toBe("price");
    expect(
      guessJourneyForSampling(
        candidate("h", "achei caro", { mediaKind: "image" }),
      ),
    ).toBe("objection");
  });

  it("cai em primeiro contato quando não há histórico nem sinal", () => {
    expect(guessJourneyForSampling(candidate("g", "bom dia"))).toBe(
      "first-contact",
    );
  });

  // O contraste IA × humano no mesmo turno é o sinal mais rico do corpus, então
  // a amostragem tem de preferi-lo — não sortear e torcer.
  it("prefere turnos em que IA e humano responderam", () => {
    const both = candidate("both", "qual o valor?", {
      aiResponse: "R$ 2.000.",
      humanResponse: "Fica 2 mil, posso te explicar.",
    });
    const onlyAi = candidate("only-ai", "qual o valor?", {
      aiResponse: "R$ 2.000.",
    });

    const selected = selectStratifiedCandidates([onlyAi, both], { price: 1 });

    expect(selected.map((entry) => entry.candidateId)).toEqual(["both"]);
  });

  it("não inventa cota para jornada que o banco quase não tem", () => {
    const selected = selectStratifiedCandidates(
      [candidate("p1", "qual o valor?", { aiResponse: "R$ 2.000." })],
      { price: 5, audio: 3 },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]!.journey).toBe("price");
  });
});

describe("exportador de candidatos", () => {
  // O invariante mais caro de violar do ciclo: a extração lê produção. Uma
  // escrita acidental aqui atinge o histórico dos quatro tenants reais.
  it("não contém nenhuma operação de escrita", () => {
    const source = readFileSync("scripts/export-corpus-candidates.ts", "utf8");
    expect(source).not.toMatch(/\b(insert|update|delete|drop|truncate|alter)\s+/i);
    expect(source).not.toMatch(/db\.(insert|update|delete|execute)\b/);
  });
});
