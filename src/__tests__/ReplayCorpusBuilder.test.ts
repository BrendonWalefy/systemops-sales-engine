import { describe, expect, it } from "vitest";
import { buildSanitizedReplayCorpus } from "@/application/replay/build-sanitized-replay-corpus";
import { fingerprintReplayConfig } from "@/application/replay/fingerprint-replay-config";

const HASH_KEY = "test-key-with-at-least-thirty-two-characters";

function buildFixture() {
  return buildSanitizedReplayCorpus({
    datasetVersion: "baseline-1",
    generatedAt: new Date("2026-07-24T12:00:00.000Z"),
    clinicKey: "clinic-a",
    timezone: "America/Sao_Paulo",
    configFingerprint: fingerprintReplayConfig({ b: 2, a: 1 }),
    playbookFingerprint: fingerprintReplayConfig({ tone: "acolhedor" }),
    sourceHashKey: HASH_KEY,
    conversations: [
      {
        sourceId: "4f73a495-8169-4d69-9b9c-cf797f6dfc75",
        leadName: "João Silva",
        messages: [
          {
            sourceId: "4e9970c3-f914-45c6-a0d8-a2e80ce3e76c",
            author: "lead",
            body: "Meu nome é João Silva, meu CPF 123.456.789-00 e telefone (11) 98765-4321. joao@example.com",
            mediaType: null,
            sentAt: new Date("2026-07-20T12:00:00.000Z"),
          },
          {
            sourceId: "39821bb9-eaca-4e5c-9a2a-fc146f681a6b",
            author: "lead",
            body: "Moro na Avenida Paulista, 1000, CEP 01310-100. https://example.com/foto",
            mediaType: "image",
            sentAt: new Date("2026-07-20T12:00:03.000Z"),
          },
          {
            sourceId: "19cc51a7-1e85-4ad6-b272-ce66587f5f52",
            author: "operator",
            body: "Olá, João. Vou verificar.",
            mediaType: null,
            sentAt: new Date("2026-07-20T12:00:10.000Z"),
          },
        ],
      },
    ],
  });
}

describe("buildSanitizedReplayCorpus", () => {
  it("anonimiza PII, remove IDs reais e preserva ordem, timing e mídia", () => {
    const dataset = buildFixture();
    const serialized = JSON.stringify(dataset);
    const scenario = dataset.scenarios[0]!;

    expect(dataset.status).toBe("needs_review");
    expect(dataset.sanitization).toEqual({
      automated: true,
      humanReviewRequired: true,
      humanReviewApprovedAt: null,
    });
    expect(dataset.approval).toBeNull();
    expect(serialized).not.toContain("João");
    expect(serialized).not.toContain("123.456.789-00");
    expect(serialized).not.toContain("98765-4321");
    expect(serialized).not.toContain("joao@example.com");
    expect(serialized).not.toContain("4f73a495-8169-4d69-9b9c-cf797f6dfc75");
    expect(scenario.turns.map((turn) => turn.offsetMs)).toEqual([0, 3_000, 10_000]);
    expect(scenario.turns[1]?.content).toEqual({
      type: "image",
      text: expect.stringContaining("[MIDIA:IMAGE]"),
    });
    expect(scenario.tags).toEqual(
      expect.arrayContaining(["historical", "has_media", "has_operator", "burst"]),
    );
    expect(scenario.compatibleModes).toContain("concurrency");
  });

  it("gera referências determinísticas sem depender da data de exportação", () => {
    const first = buildFixture();
    const second = {
      ...buildFixture(),
      generatedAt: "2026-07-25T12:00:00.000Z",
    };

    expect(first.scenarios).toEqual(second.scenarios);
  });

  it("exclui conversas sem resposta da IA ou operador", () => {
    const dataset = buildSanitizedReplayCorpus({
      datasetVersion: "baseline-1",
      generatedAt: new Date("2026-07-24T12:00:00.000Z"),
      clinicKey: "clinic-a",
      timezone: "America/Sao_Paulo",
      configFingerprint: "config",
      playbookFingerprint: null,
      sourceHashKey: HASH_KEY,
      conversations: [{
        sourceId: "conversation-1",
        leadName: null,
        messages: [{
          sourceId: "message-1",
          author: "lead",
          body: "Olá",
          mediaType: null,
          sentAt: new Date("2026-07-20T12:00:00.000Z"),
        }],
      }],
    });

    expect(dataset.scenarioCount).toBe(0);
    expect(dataset.scenarios).toEqual([]);
  });

  it("valida o nome apenas dentro da conversa de origem", () => {
    const dataset = buildSanitizedReplayCorpus({
      datasetVersion: "baseline-1",
      generatedAt: new Date("2026-07-24T12:00:00.000Z"),
      clinicKey: "clinic-a",
      timezone: "America/Sao_Paulo",
      configFingerprint: "config",
      playbookFingerprint: null,
      sourceHashKey: HASH_KEY,
      conversations: [
        {
          sourceId: "conversation-rosa",
          leadName: "Rosa Lima",
          messages: [
            {
              sourceId: "message-rosa-lead",
              author: "lead",
              body: "Olá",
              mediaType: null,
              sentAt: new Date("2026-07-20T12:00:00.000Z"),
            },
            {
              sourceId: "message-rosa-agent",
              author: "agent",
              body: "Olá, Rosa",
              mediaType: null,
              sentAt: new Date("2026-07-20T12:00:01.000Z"),
            },
          ],
        },
        {
          sourceId: "conversation-ana",
          leadName: "Ana Lima",
          messages: [
            {
              sourceId: "message-ana-lead",
              author: "lead",
              body: "Quero a opção rosa",
              mediaType: null,
              sentAt: new Date("2026-07-20T12:00:00.000Z"),
            },
            {
              sourceId: "message-ana-agent",
              author: "agent",
              body: "Vou verificar",
              mediaType: null,
              sentAt: new Date("2026-07-20T12:00:01.000Z"),
            },
          ],
        },
      ],
    });

    expect(dataset.scenarioCount).toBe(2);
    expect(dataset.scenarios[0]?.turns[1]?.content.text).toBe("Olá, [PACIENTE]");
    expect(dataset.scenarios[1]?.turns[0]?.content.text).toBe("Quero a opção rosa");
  });

  it("recusa chave curta de pseudonimização", () => {
    expect(() =>
      buildSanitizedReplayCorpus({
        datasetVersion: "baseline-1",
        generatedAt: new Date(),
        clinicKey: "clinic-a",
        timezone: "America/Sao_Paulo",
        configFingerprint: "config",
        playbookFingerprint: null,
        sourceHashKey: "short",
        conversations: [],
      }),
    ).toThrow("at least 32 characters");
  });
});
