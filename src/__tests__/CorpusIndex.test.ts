import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCorpusIndex,
  hashShard,
  loadCorpus,
} from "@/application/corpus/corpus-index";
import { CORPUS_CASE_VERSION } from "@/application/corpus/corpus-case";

function caseLine(caseId: string, journey: string): string {
  return JSON.stringify({
    schemaVersion: CORPUS_CASE_VERSION,
    caseId,
    journey,
    source: {
      kind: "historical",
      tenantHash: "7d1f0c2ab9",
      conversationHash: "0a91bb7c31",
      turnIndex: 1,
      capturedAt: "2026-07-18T14:22:00.000Z",
    },
    input: {
      leadMessage: "oi",
      history: [],
      state: null,
      tenantConfigRef: "dental-a",
    },
    observed: { aiResponse: "Oi! Como posso ajudar?", humanResponse: null },
    labels: {
      understanding: {
        request: "greeting",
        dialogueMove: "new_topic",
        entities: {},
        signals: {},
        safety: {},
        ambiguity: null,
      },
      expectedActionResult: { type: "greeting" },
      prose: {
        ai: {
          checklist: {
            factuallyCorrect: true,
            addressedWhatTheLeadRaised: true,
            advancedTheJourney: true,
            wouldRepeatToday: true,
          },
          label: "golden",
          rationale: "Abre a conversa e convida sem enrolar.",
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
  });
}

function corpusFixture(shards: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(join(root, "cases"), { recursive: true });
  for (const [journey, lines] of Object.entries(shards)) {
    writeFileSync(join(root, "cases", `${journey}.jsonl`), `${lines.join("\n")}\n`);
  }
  return root;
}

describe("índice do corpus", () => {
  it("carrega os shards e conta os casos por jornada", () => {
    const root = corpusFixture({
      "first-contact": [caseLine("first-contact-0001", "first-contact")],
      price: [
        caseLine("price-0001", "price"),
        caseLine("price-0002", "price"),
      ],
    });

    const corpus = loadCorpus(root);

    expect(corpus.cases).toHaveLength(3);
    expect(buildCorpusIndex(corpus).countsByJourney).toEqual({
      "first-contact": 1,
      price: 2,
    });
  });

  // caseId duplicado quebra rastreabilidade de regressão em silêncio: dois casos
  // diferentes passam a responder pelo mesmo identificador no baseline.
  it("recusa caseId repetido entre shards", () => {
    const root = corpusFixture({
      price: [caseLine("price-0001", "price")],
      objection: [caseLine("price-0001", "price")],
    });

    expect(() => loadCorpus(root)).toThrow(/price-0001/);
  });

  it("recusa caso guardado no shard de outra jornada", () => {
    const root = corpusFixture({
      objection: [caseLine("price-0001", "price")],
    });

    expect(() => loadCorpus(root)).toThrow(/objection/);
  });

  it("nomeia o arquivo e a linha quando um caso é inválido", () => {
    const root = corpusFixture({ price: ['{"schemaVersion":"corpus-case.v0"}'] });

    expect(() => loadCorpus(root)).toThrow(/price\.jsonl:1/);
  });

  // O hash é o que faz uma edição à mão no shard aparecer no diff do índice em
  // vez de passar como se o corpus não tivesse mudado.
  it("registra hash por shard, sensível ao conteúdo", () => {
    const one = corpusFixture({ price: [caseLine("price-0001", "price")] });
    const two = corpusFixture({ price: [caseLine("price-0002", "price")] });

    expect(hashShard(loadCorpus(one).shards.price!)).not.toBe(
      hashShard(loadCorpus(two).shards.price!),
    );
  });

  it("resume a distribuição de rótulos e de origem", () => {
    const root = corpusFixture({
      price: [caseLine("price-0001", "price"), caseLine("price-0002", "price")],
    });

    const index = buildCorpusIndex(loadCorpus(root));

    expect(index.totalCases).toBe(2);
    expect(index.countsBySourceKind.historical).toBe(2);
    expect(index.countsByAiProseLabel.golden).toBe(2);
  });
});
