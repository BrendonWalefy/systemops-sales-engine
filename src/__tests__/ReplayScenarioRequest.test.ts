import { describe, expect, it } from "vitest";
import type { ReplayScenarioV1 } from "@/application/replay/contracts";
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
});
