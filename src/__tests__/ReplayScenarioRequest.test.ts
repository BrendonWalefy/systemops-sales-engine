import { describe, expect, it } from "vitest";
import type {
  ReplayGoldenExpectationsV1,
  ReplayScenarioV1,
} from "@/application/replay/contracts";
import { assertReplayScenarioRequest } from "@/application/replay/replay-scenario-request";

function scenario(overrides: Partial<ReplayScenarioV1> = {}): ReplayScenarioV1 {
  return {
    schemaVersion: "replay-scenario.v1",
    id: "scenario-1",
    datasetVersion: "dataset-1",
    source: {
      kind: "curated",
      sourceRef: "opaque-ref",
      sanitized: true,
    },
    clinic: {
      clinicKey: "clinic-a",
      configFingerprint: "config-fingerprint",
      playbookFingerprint: "playbook-fingerprint",
    },
    compatibleModes: ["closed_loop", "concurrency"],
    clock: {
      startedAt: "2026-07-26T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
    },
    tags: ["burst"],
    turns: [
      {
        id: "lead-1",
        author: "lead",
        offsetMs: 0,
        content: { type: "text", text: "Olá" },
      },
      {
        id: "lead-2",
        author: "lead",
        offsetMs: 500,
        content: { type: "text", text: "Quero saber mais" },
      },
    ],
    ...overrides,
  };
}

function expectations(
  overrides: Partial<ReplayGoldenExpectationsV1> = {},
): ReplayGoldenExpectationsV1 {
  return {
    schemaVersion: "replay-golden-expectations.v1",
    requiredTraceStages: ["response.validated"],
    forbiddenTraceStages: [],
    finalConversation: { aiPaused: null, needsAttention: null },
    finalState: null,
    outbound: { minEffects: 0, maxEffects: 1, requiredKinds: ["text"] },
    calendar: { maxWriteEffects: 0 },
    ...overrides,
  };
}

describe("assertReplayScenarioRequest", () => {
  it.each(["closed_loop", "concurrency"] as const)(
    "aceita o modo executável %s quando o cenário é compatível",
    (mode) => {
      expect(
        assertReplayScenarioRequest({
          runId: "run-1234",
          mode,
          scenario: scenario(),
        }),
      ).toMatchObject({ mode });
    },
  );

  it("recusa executar cenário em modo não aprovado", () => {
    expect(() =>
      assertReplayScenarioRequest({
        runId: "run-1234",
        mode: "concurrency",
        scenario: scenario({ compatibleModes: ["closed_loop"] }),
      }),
    ).toThrow("not compatible");
  });

  it("recusa concorrência sem pelo menos dois turnos do lead", () => {
    expect(() =>
      assertReplayScenarioRequest({
        runId: "run-1234",
        mode: "concurrency",
        scenario: scenario({ turns: [scenario().turns[0]!] }),
      }),
    ).toThrow("at least two lead turns");
  });

  it("recusa falsa rajada separada por uma resposta histórica", () => {
    expect(() =>
      assertReplayScenarioRequest({
        runId: "run-1234",
        mode: "concurrency",
        scenario: scenario({
          turns: [
            scenario().turns[0]!,
            {
              id: "agent-1",
              author: "agent",
              offsetMs: 250,
              content: { type: "text", text: "Olá" },
            },
            scenario().turns[1]!,
          ],
        }),
      }),
    ).toThrow("consecutive lead burst");
  });

  it("aceita cenário legado sem expectations como executável não-golden", () => {
    const request = assertReplayScenarioRequest({
      runId: "run-1234",
      mode: "closed_loop",
      scenario: scenario(),
    });

    expect(request.scenario.expectations).toBeUndefined();
  });

  it("aceita expectations estruturadas válidas", () => {
    const request = assertReplayScenarioRequest({
      runId: "run-1234",
      mode: "closed_loop",
      scenario: scenario({ expectations: expectations() }),
    });

    expect(request.scenario.expectations).toEqual(expectations());
  });

  it("recusa stage simultaneamente obrigatório e proibido", () => {
    expect(() => assertReplayScenarioRequest({
      runId: "run-1234",
      mode: "closed_loop",
      scenario: scenario({
        expectations: expectations({
          requiredTraceStages: ["response.validated"],
          forbiddenTraceStages: ["response.validated"],
        }),
      }),
    })).toThrow("Invalid replay golden expectations");
  });

  it.each([
    ["limite mínimo negativo", expectations({ outbound: { minEffects: -1, maxEffects: 1, requiredKinds: [] } })],
    ["limite máximo negativo", expectations({ outbound: { minEffects: 0, maxEffects: -1, requiredKinds: [] } })],
    ["limite de calendário negativo", expectations({ calendar: { maxWriteEffects: -1 } })],
    ["mínimo maior que máximo", expectations({ outbound: { minEffects: 2, maxEffects: 1, requiredKinds: [] } })],
    ["stage desconhecido", expectations({ requiredTraceStages: ["missing.stage" as never] })],
    ["kind de outbound inválido", expectations({ outbound: { minEffects: 0, maxEffects: 1, requiredKinds: ["email" as never] } })],
    ["schemaVersion inválido", expectations({ schemaVersion: "replay-golden-expectations.v0" as never })],
    ["shape inválido", { schemaVersion: "replay-golden-expectations.v1" }],
  ])("recusa expectations com %s", (_label, invalidExpectations) => {
    expect(() => assertReplayScenarioRequest({
      runId: "run-1234",
      mode: "closed_loop",
      scenario: scenario({ expectations: invalidExpectations as ReplayGoldenExpectationsV1 }),
    })).toThrow("Invalid replay golden expectations");
  });
});
