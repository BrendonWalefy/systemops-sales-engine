import { describe, expect, it } from "vitest";
import {
  CORPUS_CASE_VERSION,
  parseCorpusCase,
  type CorpusCase,
} from "@/application/corpus/corpus-case";

function validCase(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: CORPUS_CASE_VERSION,
    caseId: "price-0007",
    journey: "price",
    source: {
      kind: "historical",
      tenantHash: "7d1f0c2ab9",
      conversationHash: "0a91bb7c31",
      turnIndex: 4,
      capturedAt: "2026-07-18T14:22:00.000Z",
    },
    input: {
      leadMessage: "e quanto fica a lente?",
      history: [{ author: "agent", body: "Oi! Como posso ajudar?" }],
      state: "qualifying",
      tenantConfigRef: "dental-a",
    },
    observed: {
      aiResponse: "A lente fica R$ 2.000 por unidade.",
      humanResponse: null,
    },
    labels: {
      understanding: {
        request: "price-of-service",
        dialogueMove: "new_topic",
        entities: { service: "lente" },
        signals: { purchaseIntent: "high" },
        safety: {},
        ambiguity: null,
      },
      expectedActionResult: { type: "price_inquiry" },
      prose: {
        ai: {
          checklist: {
            factuallyCorrect: true,
            addressedWhatTheLeadRaised: true,
            advancedTheJourney: false,
            wouldRepeatToday: true,
          },
          label: "acceptable",
          rationale: "Dá o preço certo e para aí, sem próximo passo.",
        },
        human: null,
      },
      betterResponder: "not_applicable",
    },
    provenance: {
      reviewer: "claude-opus-5",
      reviewedAt: "2026-08-15T12:00:00.000Z",
    },
    tags: [],
    ...overrides,
  };
}

describe("schema do caso de corpus", () => {
  it("aceita um caso bem formado e devolve o caso tipado", () => {
    const parsed: CorpusCase = parseCorpusCase(validCase());
    expect(parsed.caseId).toBe("price-0007");
    expect(parsed.labels.prose.ai?.label).toBe("acceptable");
  });

  // A evolução do schema é o requisito explícito do ciclo: um caso de versão
  // desconhecida precisa parar a carga com o nome da versão, nunca ser lido
  // parcialmente como se fosse da versão corrente.
  it("recusa versão desconhecida nomeando a versão encontrada", () => {
    expect(() =>
      parseCorpusCase(validCase({ schemaVersion: "corpus-case.v9" })),
    ).toThrow(/corpus-case\.v9/);
  });

  // Um campo com typo (`labelz`) seria descartado por um parser permissivo e o
  // caso entraria no corpus sem o rótulo que o revisor achou ter dado.
  it("recusa campo desconhecido em vez de descartá-lo em silêncio", () => {
    expect(() =>
      parseCorpusCase(validCase({ tagz: ["regression:x"] })),
    ).toThrow(/tagz/);
  });

  it("recusa rótulo de prosa que não sai do checklist informado", () => {
    const tampered = validCase() as Record<string, never>;
    const prose = (tampered.labels as Record<string, never>).prose as Record<
      string,
      never
    >;
    (prose.ai as Record<string, unknown>).label = "golden";
    expect(() => parseCorpusCase(tampered)).toThrow(/acceptable/);
  });

  it("recusa comparação IA × humano que não sai dos rótulos", () => {
    expect(() =>
      parseCorpusCase(
        validCase({
          labels: {
            ...(validCase() as { labels: Record<string, unknown> }).labels,
            betterResponder: "ai",
          },
        }),
      ),
    ).toThrow(/betterResponder/);
  });

  // O caso rotulado é o artefato que entra no repositório: telefone, e-mail ou
  // nome real ali dentro vazam para sempre no histórico do Git.
  it("recusa PII crua sobrevivente na mensagem do lead", () => {
    const withPhone = validCase() as { input: { leadMessage: string } };
    withPhone.input.leadMessage = "meu whats é (11) 92038-4039";
    expect(() => parseCorpusCase(withPhone)).toThrow(/PII/i);
  });

  it("exige referência de config de tenant, nunca o tenant real", () => {
    const withoutRef = validCase() as { input: Record<string, unknown> };
    delete withoutRef.input.tenantConfigRef;
    expect(() => parseCorpusCase(withoutRef)).toThrow(/tenantConfigRef/);
  });

  // caseId estável é o que faz um caso de regressão continuar sendo o mesmo caso
  // depois de o corpus crescer. Formato livre convida a renumeração.
  it("exige caseId no formato <jornada>-<sequência>", () => {
    expect(() => parseCorpusCase(validCase({ caseId: "Preço 7" }))).toThrow(
      /caseId/,
    );
  });

  it("exige que o caseId comece pela jornada do caso", () => {
    expect(() =>
      parseCorpusCase(validCase({ caseId: "media-0007" })),
    ).toThrow(/journey/);
  });
});
