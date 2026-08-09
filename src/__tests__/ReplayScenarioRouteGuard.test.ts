import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  ReplayDatasetV2,
  ReplayGoldenExpectationsV1,
  ReplayScenarioV1,
} from "@/application/replay/contracts";
import { approveReplayDataset } from "@/application/replay/replay-dataset-approval";
import type { ReplayCalendarEffect } from "@/application/replay/replay-calendar-capture";
import type { ReplayOutboundEffect } from "@/application/replay/replay-outbound-capture";
import type { DecisionTraceEventV1 } from "@/core/observability/DecisionTrace";
import * as replayScenarioRoute from "@/app/api/e2e/replay/scenario/route";

const { POST } = replayScenarioRoute;
const execFileAsync = promisify(execFile);

type ReplayCheck = { code: string; passed: boolean };
type ApplyReplayGoldenGate = (input: {
  fidelityChecks: ReplayCheck[];
  expectations?: ReplayGoldenExpectationsV1;
  trace: DecisionTraceEventV1[];
  finalConversation: { aiPaused: boolean; needsAttention: boolean } | null;
  finalState: string | null;
  outboundEffects: ReplayOutboundEffect[];
  calendarEffects: ReplayCalendarEffect[];
}) => { checks: ReplayCheck[]; status: 200 | 422 };

const goldenExpectations = (): ReplayGoldenExpectationsV1 => ({
  schemaVersion: "replay-golden-expectations.v1",
  requiredTraceStages: [],
  forbiddenTraceStages: [],
  finalConversation: { aiPaused: true, needsAttention: false },
  finalState: "awaiting_confirmation",
  outbound: { minEffects: 0, maxEffects: 10, requiredKinds: [] },
  calendar: { maxWriteEffects: 0 },
});

describe("replay scenario route guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("não existe fora do modo E2E", async () => {
    vi.stubEnv("E2E_MODE", "false");
    const response = await POST(new NextRequest(
      "http://localhost/api/e2e/replay/scenario",
      { method: "POST", body: "{}" },
    ));

    expect(response.status).toBe(404);
  });

  it("recusa chamada sem o segredo E2E", async () => {
    vi.stubEnv("E2E_MODE", "true");
    vi.stubEnv("E2E_SECRET", "expected");
    const response = await POST(new NextRequest(
      "http://localhost/api/e2e/replay/scenario",
      { method: "POST", body: "{}" },
    ));

    expect(response.status).toBe(401);
  });

  it("anexa checks golden e bloqueia sucesso quando o snapshot terminal diverge", () => {
    const applyReplayGoldenGate = (
      replayScenarioRoute as unknown as Record<string, unknown>
    ).applyReplayGoldenGate as ApplyReplayGoldenGate | undefined;
    expect(applyReplayGoldenGate).toBeTypeOf("function");
    if (!applyReplayGoldenGate) return;

    const result = applyReplayGoldenGate({
      fidelityChecks: [{ code: "trace_complete", passed: true }],
      expectations: goldenExpectations(),
      trace: [],
      finalConversation: { aiPaused: false, needsAttention: false },
      finalState: "idle",
      outboundEffects: [],
      calendarEffects: [],
    });

    expect(result.status).toBe(422);
    expect(result.checks).toContainEqual({
      code: "golden_final_ai_paused",
      passed: false,
    });
    expect(result.checks).toContainEqual({
      code: "golden_final_state",
      passed: false,
    });
    expect(result.checks.every(
      (check) => Object.keys(check).join(",") === "code,passed",
    )).toBe(true);
  });

  it("mantém cenário sem expectativas executável e explicitamente não golden", () => {
    const applyReplayGoldenGate = (
      replayScenarioRoute as unknown as Record<string, unknown>
    ).applyReplayGoldenGate as ApplyReplayGoldenGate | undefined;
    expect(applyReplayGoldenGate).toBeTypeOf("function");
    if (!applyReplayGoldenGate) return;

    expect(applyReplayGoldenGate({
      fidelityChecks: [{ code: "trace_complete", passed: true }],
      trace: [],
      finalConversation: null,
      finalState: null,
      outboundEffects: [],
      calendarEffects: [],
    })).toEqual({
      checks: [{ code: "trace_complete", passed: true }],
      status: 200,
    });
  });

  it("retorna sucesso golden somente quando fidelidade e expectativas passam", () => {
    const applyReplayGoldenGate = (
      replayScenarioRoute as unknown as Record<string, unknown>
    ).applyReplayGoldenGate as ApplyReplayGoldenGate | undefined;
    expect(applyReplayGoldenGate).toBeTypeOf("function");
    if (!applyReplayGoldenGate) return;

    expect(applyReplayGoldenGate({
      fidelityChecks: [{ code: "trace_complete", passed: true }],
      expectations: goldenExpectations(),
      trace: [],
      finalConversation: { aiPaused: true, needsAttention: false },
      finalState: "awaiting_confirmation",
      outboundEffects: [],
      calendarEffects: [],
    }).status).toBe(200);
    expect(applyReplayGoldenGate({
      fidelityChecks: [{ code: "trace_complete", passed: false }],
      expectations: goldenExpectations(),
      trace: [],
      finalConversation: { aiPaused: true, needsAttention: false },
      finalState: "awaiting_confirmation",
      outboundEffects: [],
      calendarEffects: [],
    }).status).toBe(422);
  });

  it("separa contagens golden das legadas e mantém stdout sem detalhes", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "replay-batch-golden-"),
    );
    const datasetPath = path.join(temporaryDirectory, "approved.json");
    const publicKeyPath = path.join(temporaryDirectory, "public.pem");
    const outputPath = path.join(temporaryDirectory, "private-report.json");
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const scenarioId = (JSON.parse(body) as { scenario: { id: string } })
          .scenario.id;
        response.statusCode = scenarioId === "golden-fail" ? 422 : 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ privateDetail: "transcript-secret" }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test replay server did not bind to a TCP port");
      }
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const approved = approveReplayDataset({
        dataset: replayDataset([
          replayScenario("golden-pass", goldenExpectations()),
          replayScenario("golden-fail", goldenExpectations()),
          replayScenario("legacy-pass"),
        ]),
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
        approvedAt: new Date("2026-08-09T12:00:00.000Z"),
        approvedBy: "qa-owner",
      });
      await writeFile(datasetPath, `${JSON.stringify(approved)}\n`);
      await writeFile(
        publicKeyPath,
        publicKey.export({ type: "spki", format: "pem" }),
      );

      let stdout = "";
      try {
        const result = await execFileAsync(
          path.resolve("node_modules/.bin/tsx"),
          [
            "scripts/run-approved-replay-dataset.ts",
            "--dataset", datasetPath,
            "--public-key", publicKeyPath,
            "--endpoint", `http://127.0.0.1:${address.port}/replay`,
            "--secret", "test-secret",
            "--output", outputPath,
          ],
          { cwd: process.cwd() },
        );
        stdout = result.stdout;
      } catch (error) {
        stdout = (error as { stdout?: string }).stdout ?? "";
      }

      const report = JSON.parse(await readFile(outputPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(report).toMatchObject({
        runCount: 3,
        passedCount: 2,
        failedCount: 1,
        goldenRunCount: 2,
        goldenPassedCount: 1,
        goldenFailedCount: 1,
        legacyRunCount: 1,
        legacyPassedCount: 1,
        legacyFailedCount: 0,
      });
      expect(JSON.parse(stdout.trim())).toEqual({
        output: outputPath,
        runCount: 3,
        passedCount: 2,
        failedCount: 1,
        goldenRunCount: 2,
        goldenPassedCount: 1,
        goldenFailedCount: 1,
        legacyRunCount: 1,
        legacyPassedCount: 1,
        legacyFailedCount: 0,
        status: "failed",
      });
      expect(stdout).not.toContain("transcript-secret");
    } finally {
      server.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});

function replayScenario(
  id: string,
  expectations?: ReplayGoldenExpectationsV1,
): ReplayScenarioV1 {
  return {
    schemaVersion: "replay-scenario.v1",
    id,
    datasetVersion: "golden-batch-v1",
    source: { kind: "synthetic", sourceRef: `${id}-ref`, sanitized: true },
    clinic: {
      clinicKey: "replay-clinic",
      configFingerprint: "config-fingerprint",
      playbookFingerprint: "playbook-fingerprint",
    },
    compatibleModes: ["closed_loop"],
    clock: {
      startedAt: "2026-08-09T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
    },
    tags: ["synthetic"],
    turns: [{
      id: "turn-1",
      author: "lead",
      offsetMs: 0,
      content: { type: "text", text: "sanitized fixture" },
    }],
    ...(expectations ? { expectations } : {}),
  };
}

function replayDataset(scenarios: ReplayScenarioV1[]): ReplayDatasetV2 {
  return {
    schemaVersion: "replay-dataset.v2",
    datasetVersion: "golden-batch-v1",
    generatedAt: "2026-08-09T12:00:00.000Z",
    status: "needs_review",
    sanitization: {
      automated: true,
      humanReviewRequired: true,
      humanReviewApprovedAt: null,
    },
    approval: null,
    clinic: {
      clinicKey: "replay-clinic",
      timezone: "America/Sao_Paulo",
      configFingerprint: "config-fingerprint",
      playbookFingerprint: "playbook-fingerprint",
    },
    scenarioCount: scenarios.length,
    scenarios,
  };
}
