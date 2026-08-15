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

  // A redação por token exato não alcança nome grafado errado, e um primeiro
  // nome atravessou a barreira até uma folha entregue a revisor externo. O
  // parse é a última chance de barrar: se o texto ainda tem vocativo, não foi
  // sanitizado.
  it("recusa primeiro nome sobrevivente como vocativo depois da saudação", () => {
    const withName = validCase() as { observed: { humanResponse: string } };
    withName.observed.humanResponse = "Olá Weberson boa tarde";
    expect(() => parseCorpusCase(withName)).toThrow(/PII/i);
  });

  it("aceita saudação seguida de palavra comum, que não é nome", () => {
    const withoutName = validCase() as { observed: { humanResponse: string } };
    withoutName.observed.humanResponse = "Bom dia Nosso horário é das 8h às 18h";
    expect(() => parseCorpusCase(withoutName)).not.toThrow();
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

  // "Agendei quarta às 15h" só é verificável se o corpus puder dizer que um
  // agendamento foi de fato criado. Sem isso, afirmação e evidência são a mesma
  // linha de texto, e a pergunta de lastro não tem como ser respondida.
  it("registra side effect com o que aconteceu e de onde se sabe", () => {
    const withEffect = validCase() as { observed: Record<string, unknown> };
    withEffect.observed.sideEffects = [
      { kind: "media_sent", detail: "vídeo", source: "messages.media_type" },
    ];

    const parsed = parseCorpusCase(withEffect);

    expect(parsed.observed.sideEffects?.[0]?.kind).toBe("media_sent");
  });

  it("recusa side effect sem proveniência", () => {
    const noSource = validCase() as { observed: Record<string, unknown> };
    noSource.observed.sideEffects = [{ kind: "media_sent", detail: "vídeo" }];

    expect(() => parseCorpusCase(noSource)).toThrow(/source/);
  });

  it("recusa side effect fora do vocabulário mínimo", () => {
    const unknown = validCase() as { observed: Record<string, unknown> };
    unknown.observed.sideEffects = [
      { kind: "enviou_email", detail: "x", source: "y" },
    ];

    expect(() => parseCorpusCase(unknown)).toThrow(/kind/);
  });

  // Um caso cuja premissa contradiz a própria fixture não tem ground truth
  // consistente: calibrar uma pergunta contra ele mede o defeito do caso, não a
  // pergunta. O caso continua no corpus como evidência; o campo é o que impede
  // que ele volte a servir de régua sem alguém decidir isso.
  it("aceita caso marcado como estruturalmente inválido, com motivo", () => {
    const parsed = parseCorpusCase(
      validCase({
        validity: {
          status: "fixture-invalid",
          reason: "O histórico oferece horário fora do horário do tenant.",
        },
      }),
    );

    expect(parsed.validity?.status).toBe("fixture-invalid");
  });

  it("recusa marca de invalidez sem motivo escrito", () => {
    expect(() =>
      parseCorpusCase(validCase({ validity: { status: "corpus-invalid" } })),
    ).toThrow(/reason/);
  });

  it("exige que o caseId comece pela jornada do caso", () => {
    expect(() =>
      parseCorpusCase(validCase({ caseId: "media-0007" })),
    ).toThrow(/journey/);
  });
});
