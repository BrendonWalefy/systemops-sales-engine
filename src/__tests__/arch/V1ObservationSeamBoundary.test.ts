import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const OBSERVATION_CONTRACT = "src/core/observability/V1TurnObservation.ts";
const ORCHESTRATOR = "src/core/pipeline/ConversationOrchestrator.ts";

describe("V1 observation seam boundary", () => {
  it("mantém o contrato core sem imports de V2, packs ou core novo", async () => {
    const [contract, orchestrator] = await Promise.all([
      readFile(OBSERVATION_CONTRACT, "utf8"),
      readFile(ORCHESTRATOR, "utf8"),
    ]);
    const forbidden = /(?:src\/|@\/)(?:conversation-core|domain-packs|application\/conversation-v2)(?:\/|["'])/;

    expect(contract).not.toMatch(forbidden);
    expect(orchestrator).not.toMatch(forbidden);
  });

  it("mantém o contrato como plain-data sem Date, repository, DB ou provider", async () => {
    const contract = await readFile(OBSERVATION_CONTRACT, "utf8");

    expect(contract).not.toMatch(/\bDate\b|Repository|Gateway|Provider|infrastructure\/db|\bfetch\s*\(/);
    expect(contract).not.toMatch(/Promise\s*</);
  });

  it("mantém a instrumentação turn-local e sem I/O próprio", async () => {
    const orchestrator = await readFile(ORCHESTRATOR, "utf8");
    const observationLines = orchestrator
      .split(/\r?\n/)
      .filter((line) => /turnObservationSink|recordV1TurnObservation/.test(line));

    expect(observationLines.join("\n")).not.toMatch(/\b(?:db|fetch|Repository|Gateway)\b|\bawait\b/);
    expect(orchestrator).not.toMatch(/private readonly turnObservationSink|constructor\([^)]*turnObservationSink/s);
  });
});
