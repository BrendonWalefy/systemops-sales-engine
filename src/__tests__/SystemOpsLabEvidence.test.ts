import { link, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  writeSystemOpsLabEvidence,
  type SanitizedLabTraceEvent,
  type SanitizedTranscriptMessage,
} from "@/application/labs/systemops-lab-evidence";
import type { SystemOpsLabRunResult } from "@/application/labs/systemops-lab-persona";
import {
  parseSystemOpsLabEvidenceCommandArgs,
  readSystemOpsLabRunEnvelope,
  runSystemOpsLabEvidenceCommand,
} from "../../scripts/render-systemops-lab-evidence";

const originalCwd = process.cwd();
const workspaces: string[] = [];

const run: SystemOpsLabRunResult = Object.freeze({
  runId: "evidence-run-20260817",
  clinicId: "11111111-1111-4111-8111-111111111111",
  personaId: "price-scheduling",
  conversationId: "opaque-conversation-id",
  turns: Object.freeze([
    Object.freeze({
      turnId: "opaque-turn-1",
      leadMessageId: "opaque-lead-1",
      outboundMessageId: "opaque-outbound-1",
      persistedAgentMessageId: "opaque-agent-1",
      captured: true as const,
    }),
    Object.freeze({
      turnId: "opaque-turn-2",
      leadMessageId: "opaque-lead-2",
      outboundMessageId: "opaque-outbound-2",
      persistedAgentMessageId: "opaque-agent-2",
      captured: true as const,
    }),
  ]),
});

const messages: readonly SanitizedTranscriptMessage[] = Object.freeze([
  Object.freeze({
    turnId: "opaque-turn-1",
    messageId: "opaque-lead-1",
    author: "lead" as const,
    text: "Quanto custa o clareamento e tem horario amanha?",
  }),
  Object.freeze({
    turnId: "opaque-turn-1",
    messageId: "opaque-agent-1",
    author: "agent" as const,
    text: "Posso consultar o valor e os horarios disponiveis.",
  }),
  Object.freeze({
    turnId: "opaque-turn-2",
    messageId: "opaque-lead-2",
    author: "lead" as const,
    text: "Pode reservar a primeira opcao?",
  }),
  Object.freeze({
    turnId: "opaque-turn-2",
    messageId: "opaque-agent-2",
    author: "agent" as const,
    text: "A reserva foi confirmada.",
  }),
]);

function turnTrace(
  turnId: string,
  sequenceBase: number,
  options: Readonly<{
    request?: "price-of-service" | "book-appointment";
    executeCount?: number;
    completedEffectCount?: number;
    failedEffectCount?: number;
    validationValid?: boolean;
    violations?: string;
    messageWasNew?: boolean;
    jobWasNew?: boolean;
  }> = {},
): readonly SanitizedLabTraceEvent[] {
  return Object.freeze([
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase,
      stage: "engine.selected" as const,
      occurredAt: "2026-08-17T15:00:00.000Z",
      metadata: Object.freeze({
        route: "v2",
        shadow: false,
        reason: "internal_lab_authorized",
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 1,
      stage: "v2.understanding" as const,
      occurredAt: "2026-08-17T15:00:00.010Z",
      metadata: Object.freeze({
        status: "completed",
        durationMs: 10,
        modelId: "gpt-4o-mini",
        request: options.request ?? "price-of-service",
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 2,
      stage: "v2.decision" as const,
      occurredAt: "2026-08-17T15:00:00.020Z",
      metadata: Object.freeze({
        status: "prepared",
        durationMs: 20,
        decisionCount: 1,
        executeCount: options.executeCount ?? 0,
        capabilityIds: (options.request ?? "price-of-service") === "price-of-service"
          ? "dental-catalog"
          : "dental-scheduling",
        decisionKinds: (options.executeCount ?? 0) > 0 ? "execute" : "answer",
        intendedEffects: (options.executeCount ?? 0) > 0 ? "book_slot" : "none",
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 3,
      stage: "v2.action_result" as const,
      occurredAt: "2026-08-17T15:00:00.030Z",
      metadata: Object.freeze({
        status: "completed",
        durationMs: 30,
        resultCount: 1,
        completedEffectCount: options.completedEffectCount ?? 0,
        failedEffectCount: options.failedEffectCount ?? 0,
        outcomeTypes: (options.request ?? "price-of-service") === "price-of-service"
          ? "catalog_answered"
          : (options.failedEffectCount ?? 0) > 0
            ? "appointment_create_failed"
            : (options.completedEffectCount ?? 0) > 0
              ? "appointment_created"
              : "clarification_required",
        semanticClasses: (options.request ?? "price-of-service") === "price-of-service"
          ? "information_authorized"
          : (options.failedEffectCount ?? 0) > 0
            ? "effect_failed"
            : (options.completedEffectCount ?? 0) > 0
              ? "effect_completed"
              : "clarification_required",
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 4,
      stage: "response.plan_built" as const,
      occurredAt: "2026-08-17T15:00:00.040Z",
      metadata: Object.freeze({
        action: "v2_response",
        planVersion: "authorized-response-plan.v2",
        allowedPriceCount: (options.request ?? "price-of-service") === "price-of-service" ? 1 : 0,
        allowedScheduleFactCount: options.request === "book-appointment" ? 1 : 0,
        allowedMediaCount: 0,
        outcomeRefs: "outcome-0",
        evidenceRefs: "evidence-0",
        outcomeCount: 1,
        factCount: 1,
        optionCount: options.request === "book-appointment" ? 1 : 0,
        subjectCount: 1,
        evidenceCount: 1,
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 5,
      stage: "response.validated" as const,
      occurredAt: "2026-08-17T15:00:00.050Z",
      metadata: Object.freeze({
        action: "v2_response",
        valid: options.validationValid ?? true,
        violationCount: options.violations ? 1 : 0,
        violations: options.violations ?? "",
        requiresHandoff: false,
        source: (options.validationValid ?? true) ? "draft" : "none",
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 6,
      stage: "v2.outbox" as const,
      occurredAt: "2026-08-17T15:00:00.060Z",
      metadata: Object.freeze({
        status: "enqueued",
        durationMs: 5,
        messageWasNew: options.messageWasNew ?? true,
        jobWasNew: options.jobWasNew ?? true,
      }),
    }),
    Object.freeze({
      schemaVersion: "decision-trace.v1" as const,
      turnId,
      sequence: sequenceBase + 7,
      stage: "delivery.sent" as const,
      occurredAt: "2026-08-17T15:00:00.070Z",
      metadata: Object.freeze({ status: "captured" }),
    }),
  ]);
}

const trace: readonly SanitizedLabTraceEvent[] = Object.freeze([
  ...turnTrace("opaque-turn-1", 0),
  ...turnTrace("opaque-turn-2", 10, {
    request: "book-appointment",
    executeCount: 1,
    completedEffectCount: 1,
  }),
]);

async function enterWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "systemops-lab-evidence-"));
  workspaces.push(workspace);
  process.chdir(workspace);
  return workspace;
}

async function relativeFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else result.push(path.relative(root, absolute));
    }
  }
  await visit(root);
  return result.sort();
}

async function writeFixture(input: Readonly<{
  fixtureMessages?: readonly SanitizedTranscriptMessage[];
  fixtureTrace?: readonly SanitizedLabTraceEvent[];
}> = {}) {
  return writeSystemOpsLabEvidence({
    outputRoot: "evals/systemops-lab",
    run,
    messages: input.fixtureMessages ?? messages,
    trace: input.fixtureTrace ?? trace,
  });
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(workspaces.splice(0).map((workspace) =>
    rm(workspace, { recursive: true, force: true })));
});

describe("SystemOps Lab evidence", () => {
  it("accepts only the protected run envelope plus an exact clinic binding operationally", () => {
    expect(parseSystemOpsLabEvidenceCommandArgs([
      "--run-file", "/tmp/systemops-lab-run.json",
      "--clinic-id", run.clinicId,
      "--output-root", "evals/systemops-lab",
    ])).toEqual({
      runFile: "/tmp/systemops-lab-run.json",
      clinicId: run.clinicId,
      outputRoot: "evals/systemops-lab",
    });
    expect(() => parseSystemOpsLabEvidenceCommandArgs([
      "--run-file", "/tmp/systemops-lab-run.json",
      "--clinic-id", run.clinicId,
      "--messages-file", "/tmp/messages.json",
      "--output-root", "evals/systemops-lab",
    ])).toThrow(/unknown|messages-file/i);
    expect(() => parseSystemOpsLabEvidenceCommandArgs([
      "--run-file", path.resolve("..outside/run.json"),
      "--clinic-id", run.clinicId,
      "--output-root", "evals/systemops-lab",
    ])).toThrow(/protected|outside|repository/i);
  });

  it("loads the exact tenant conversation messages and Decision Trace from canonical persistence", async () => {
    const workspace = await enterWorkspace();
    const listMessages = vi.fn().mockResolvedValue({
      messages: messages.map((message) => ({
        id: message.messageId,
        conversationId: run.conversationId,
        author: message.author,
        body: message.text,
      })),
      hasMore: false,
    });
    const listTrace = vi.fn().mockResolvedValue(run.turns.map((turn) => ({
      turnId: turn.turnId,
      clinicId: run.clinicId,
      conversationId: run.conversationId,
      events: trace.filter((event) => event.turnId === turn.turnId).map((event) => ({
        turnId: event.turnId,
        clinicId: run.clinicId,
        ...(event.stage === "engine.selected" ? {} : { conversationId: run.conversationId }),
        stage: event.stage,
        occurredAt: event.occurredAt,
        metadata: event.stage === "delivery.sent"
          ? { providerAccepted: true, outboundMessageId: turn.outboundMessageId }
          : event.metadata,
      })),
    })));
    const write = vi.fn();
    const readRun = vi.fn().mockResolvedValue(run);

    await runSystemOpsLabEvidenceCommand({
      runFile: "/tmp/systemops-lab-protected-run.json",
      clinicId: run.clinicId,
      outputRoot: "evals/systemops-lab",
    }, {
      readRun,
      listMessages,
      listTrace,
      writeEvidence: writeSystemOpsLabEvidence,
      write,
    });

    const binding = { clinicId: run.clinicId, conversationId: run.conversationId };
    expect(readRun).toHaveBeenCalledWith(path.join(
      await realpath("/tmp"),
      "systemops-lab-protected-run.json",
    ));
    expect(listMessages).toHaveBeenCalledWith(binding);
    expect(listTrace).toHaveBeenCalledWith(binding);
    expect(await relativeFiles(path.join(workspace, "evals/systemops-lab"))).toEqual([
      "evidence-run-20260817/evaluation.json",
      "evidence-run-20260817/trace.json",
      "evidence-run-20260817/transcript.md",
      "latest-summary.md",
    ]);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"artifactCount":4'));
  });

  it.each([
    ["cross-tenant", { clinicId: "22222222-2222-4222-8222-222222222222" }],
    ["cross-conversation", { conversationId: "another-conversation" }],
    ["missing-turn", { omitLast: true }],
    ["extra-turn", { extraTurn: true }],
  ] as const)("rejects %s Decision Trace provenance", async (_label, mutation) => {
    await enterWorkspace();
    const batches = run.turns.map((turn) => ({
      turnId: turn.turnId,
      clinicId: "clinicId" in mutation ? mutation.clinicId : run.clinicId,
      conversationId: "conversationId" in mutation
        ? mutation.conversationId
        : run.conversationId,
      events: trace.filter((event) => event.turnId === turn.turnId).map((event) => ({
        turnId: event.turnId,
        clinicId: run.clinicId,
        conversationId: run.conversationId,
        stage: event.stage,
        occurredAt: event.occurredAt,
        metadata: event.metadata,
      })),
    }));
    const mutated = "omitLast" in mutation
      ? batches.slice(0, -1)
      : "extraTurn" in mutation
        ? [...batches, { ...batches[0]!, turnId: "extra-turn" }]
        : batches;

    await expect(runSystemOpsLabEvidenceCommand({
      runFile: "/tmp/systemops-lab-protected-run.json",
      clinicId: run.clinicId,
      outputRoot: "evals/systemops-lab",
    }, {
      readRun: vi.fn().mockResolvedValue(run),
      listMessages: vi.fn().mockResolvedValue({
        messages: messages.map((message) => ({
          id: message.messageId,
          conversationId: run.conversationId,
          author: message.author,
          body: message.text,
        })),
        hasMore: false,
      }),
      listTrace: vi.fn().mockResolvedValue(mutated),
      writeEvidence: vi.fn(),
      write: vi.fn(),
    })).rejects.toThrow(/trace|tenant|conversation|turn/i);
  });

  it.each(["missing", "extra", "cross-conversation"] as const)(
    "rejects %s persisted message provenance",
    async (mutation) => {
      await enterWorkspace();
      const persisted = messages.map((message) => ({
        id: message.messageId,
        conversationId: mutation === "cross-conversation"
          ? "another-conversation"
          : run.conversationId,
        author: message.author,
        body: message.text,
      }));
      const mutated = mutation === "missing"
        ? persisted.slice(0, -1)
        : mutation === "extra"
          ? [...persisted, { ...persisted[0]!, id: "extra-message" }]
          : persisted;

      await expect(runSystemOpsLabEvidenceCommand({
        runFile: "/tmp/systemops-lab-protected-run.json",
        clinicId: run.clinicId,
        outputRoot: "evals/systemops-lab",
      }, {
        readRun: vi.fn().mockResolvedValue(run),
        listMessages: vi.fn().mockResolvedValue({ messages: mutated, hasMore: false }),
        listTrace: vi.fn().mockResolvedValue([]),
        writeEvidence: vi.fn(),
        write: vi.fn(),
      })).rejects.toThrow(/message|provenance|missing|extra/i);
    },
  );

  it("rejects a delivery trace for a different outbound than the protected Task10 run", async () => {
    await enterWorkspace();
    const listTrace = vi.fn().mockResolvedValue(run.turns.map((turn) => ({
      turnId: turn.turnId,
      clinicId: run.clinicId,
      conversationId: run.conversationId,
      events: trace.filter((event) => event.turnId === turn.turnId).map((event) => ({
        turnId: event.turnId,
        clinicId: run.clinicId,
        conversationId: run.conversationId,
        stage: event.stage,
        occurredAt: event.occurredAt,
        metadata: event.stage === "delivery.sent"
          ? { providerAccepted: true, outboundMessageId: "another-outbound" }
          : event.metadata,
      })),
    })));

    await expect(runSystemOpsLabEvidenceCommand({
      runFile: "/tmp/systemops-lab-protected-run.json",
      clinicId: run.clinicId,
      outputRoot: "evals/systemops-lab",
    }, {
      readRun: vi.fn().mockResolvedValue(run),
      listMessages: vi.fn().mockResolvedValue({
        messages: messages.map((message) => ({
          id: message.messageId,
          conversationId: run.conversationId,
          author: message.author,
          body: message.text,
        })),
        hasMore: false,
      }),
      listTrace,
      writeEvidence: vi.fn(),
      write: vi.fn(),
    })).rejects.toThrow(/exact|captured|outbound/i);
  });

  it("writes exactly three run files plus latest-summary", async () => {
    const workspace = await enterWorkspace();

    await writeFixture();

    expect(await relativeFiles(path.join(workspace, "evals/systemops-lab"))).toEqual([
      "evidence-run-20260817/evaluation.json",
      "evidence-run-20260817/trace.json",
      "evidence-run-20260817/transcript.md",
      "latest-summary.md",
    ]);
  });

  it("never promotes human or owner review", async () => {
    const workspace = await enterWorkspace();

    const evaluation = await writeFixture();
    const transcript = await readFile(path.join(
      workspace,
      "evals/systemops-lab/evidence-run-20260817/transcript.md",
    ), "utf8");

    expect(evaluation.humanReview).toBe("pending");
    expect(evaluation.ownerReview).toBe("pending");
    expect(transcript).toContain("HUMAN REVIEW: PENDING");
    expect(transcript).toContain("OWNER REVIEW: PENDING");
    expect(transcript).toContain("APROVAR");
    expect(transcript).toContain("RUIM");
    expect(transcript).toContain("CRIAR REGRESSÃO");
  });

  it("renders persisted lead-agent turns without opaque persistence identifiers", async () => {
    const workspace = await enterWorkspace();

    await writeFixture();
    const transcript = await readFile(path.join(
      workspace,
      "evals/systemops-lab/evidence-run-20260817/transcript.md",
    ), "utf8");
    const renderedTrace = await readFile(path.join(
      workspace,
      "evals/systemops-lab/evidence-run-20260817/trace.json",
    ), "utf8");

    expect(transcript).toContain("Quanto custa o clareamento");
    expect(transcript).toContain("A reserva foi confirmada.");
    expect(`${transcript}${renderedTrace}`).not.toMatch(/opaque-(?:conversation|turn|lead|agent|outbound)/);
  });

  it("renders the Section 15 capability, decision, outcome, plan, validator, and persisted FinalText chain", async () => {
    const workspace = await enterWorkspace();

    await writeFixture();
    const rendered = JSON.parse(await readFile(path.join(
      workspace,
      "evals/systemops-lab/evidence-run-20260817/trace.json",
    ), "utf8")) as {
      events: Array<{ stage: string; metadata: Record<string, unknown> }>;
      finalTexts: Array<{ turn: string; evidenceRef: string; value: string }>;
    };

    expect(rendered.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.decision",
        metadata: expect.objectContaining({
          capabilityIds: "dental-catalog",
          decisionKinds: "answer",
        }),
      }),
      expect.objectContaining({
        stage: "v2.action_result",
        metadata: expect.objectContaining({
          outcomeTypes: "catalog_answered",
          semanticClasses: "information_authorized",
        }),
      }),
      expect.objectContaining({
        stage: "response.plan_built",
        metadata: expect.objectContaining({
          outcomeRefs: "outcome-0",
          evidenceRefs: "evidence-0",
        }),
      }),
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({ source: "draft" }),
      }),
    ]));
    expect(rendered.finalTexts).toEqual([
      {
        turn: "turn-1",
        evidenceRef: "message:turn-1:agent",
        value: messages[1]!.text,
      },
      {
        turn: "turn-2",
        evidenceRef: "message:turn-2:agent",
        value: messages[3]!.text,
      },
    ]);
  });

  it.each([
    ["phone", "+5511999999999"],
    ["formatted phone", "(11) 99999 9999"],
    ["CPF", "123.456.789-09"],
    ["email", "pessoa@example.com"],
    ["secret", "sk-proj-abcdefghijklmnopqrstuvwxyz123456"],
    ["private URL", "http://127.0.0.1:3000/internal"],
    ["IPv6 private URL", "http://[::1]/internal"],
    ["IPv6 unique-local URL", "http://[fd00::1]/internal"],
    ["IPv6 link-local URL", "http://[fe80::1]/internal"],
    ["IPv4-mapped IPv6 private URL", "http://[::ffff:127.0.0.1]/internal"],
    ["localhost subdomain", "http://api.localhost/internal"],
    ["Redis private URL", "redis://10.0.0.1/0"],
    ["Postgres private URL", "postgresql://192.168.1.20/lab"],
    ["WebSocket private URL", "ws://127.0.0.1/internal"],
    ["metadata private URL", "http://169.254.169.254/latest/meta-data"],
    ["private key", "-----BEGIN PRIVATE KEY-----"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz1234567890"],
    ["AWS access key", "AKIAIOSFODNN7EXAMPLE"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue"],
    ["database credential", "postgresql://lab:super-secret-value@db.example.test/lab"],
    ["provider payload", "providerPayload: { raw: true }"],
    ["JSON provider payload", "{\"providerPayload\":{\"event\":\"x\"}}"],
  ])("rejects %s before writing any artifact", async (_label, unsafeText) => {
    const workspace = await enterWorkspace();
    const unsafeMessages = messages.map((message, index) => index === 0
      ? Object.freeze({ ...message, text: unsafeText })
      : message);

    await expect(writeFixture({ fixtureMessages: unsafeMessages })).rejects.toThrow(/sensitive|unsafe/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it("fails unauthorized facts only from a correlated validator violation", async () => {
    await enterWorkspace();
    const invalidTrace = Object.freeze([
      ...turnTrace("opaque-turn-1", 0, {
        validationValid: false,
        violations: "unauthorized_price",
      }),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        completedEffectCount: 1,
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: invalidTrace });
    const check = evaluation.checks.find(({ id }) => id === "unauthorized_facts");

    expect(check?.status).toBe("fail");
    expect(check?.evidence).toEqual(expect.arrayContaining([
      "trace:turn-1:response.validated:5",
      "message:turn-1:agent",
    ]));
  });

  it("fails price subject binding from the semantic subject mismatch", async () => {
    await enterWorkspace();
    const pricedMessages = messages.map((message) => message.messageId === "opaque-agent-1"
      ? Object.freeze({ ...message, text: "O clareamento custa R$ 500." })
      : message);
    const invalidTrace = Object.freeze([
      ...turnTrace("opaque-turn-1", 0, {
        validationValid: false,
        violations: "subject_mismatch",
      }),
      ...turnTrace("opaque-turn-2", 10),
    ]);

    const evaluation = await writeFixture({
      fixtureMessages: pricedMessages,
      fixtureTrace: invalidTrace,
    });

    expect(evaluation.checks.find(({ id }) => id === "price_subject_binding")).toEqual({
      id: "price_subject_binding",
      status: "fail",
      evidence: ["trace:turn-1:response.validated:5", "message:turn-1:agent"],
    });
  });

  it("does not label a scheduling-only subject mismatch as a price failure", async () => {
    await enterWorkspace();
    const schedulingMismatch = Object.freeze([
      ...turnTrace("opaque-turn-1", 0),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        completedEffectCount: 1,
        validationValid: false,
        violations: "subject_mismatch",
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: schedulingMismatch });

    expect(evaluation.checks.find(({ id }) => id === "price_subject_binding")?.status)
      .toBe("not_measurable");
  });

  it("requires and cites an authorized price plan before passing price subject binding", async () => {
    await enterWorkspace();
    const pricedMessages = messages.map((message) => message.messageId === "opaque-agent-1"
      ? Object.freeze({ ...message, text: "O clareamento custa R$ 500." })
      : message);

    const evaluation = await writeFixture({ fixtureMessages: pricedMessages });
    const check = evaluation.checks.find(({ id }) => id === "price_subject_binding");

    expect(check?.status).toBe("pass");
    expect(check?.evidence).toContain("trace:turn-1:response.plan_built:4");
  });

  it("does not attribute a blocked draft violation to the delivered fallback", async () => {
    await enterWorkspace();
    const firstTurn = turnTrace("opaque-turn-1", 0, {
      validationValid: false,
      violations: "unauthorized_price",
    }).map((event) => {
      if (event.stage === "v2.outbox" || event.stage === "delivery.sent") {
        return ({ ...event, sequence: event.sequence + 1 });
      }
      if (event.stage === "response.validated") {
        return ({
          ...event,
          metadata: {
            ...event.metadata,
            valid: true,
            violationCount: 0,
            violations: "",
            source: "fallback" as const,
          },
        });
      }
      return event;
    });
    const fallbackEvent: SanitizedLabTraceEvent = Object.freeze({
      schemaVersion: "decision-trace.v1",
      turnId: "opaque-turn-1",
      sequence: 6,
      stage: "response.fallback_applied",
      occurredAt: "2026-08-17T15:00:00.055Z",
      metadata: Object.freeze({
        action: "v2_response",
        fallbackReason: "response_plan_violation",
        requiresHandoff: false,
      }),
    });
    const fallbackTrace = Object.freeze([
      ...firstTurn.slice(0, 6),
      fallbackEvent,
      ...firstTurn.slice(6),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        completedEffectCount: 1,
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: fallbackTrace });

    expect(evaluation.checks.find(({ id }) => id === "unauthorized_facts")?.status)
      .toBe("not_measurable");
    expect(evaluation.checks.find(({ id }) => id === "critical_regression")?.status)
      .toBe("not_measurable");
  });

  it("detects booking failure inversion without treating a failed write as success", async () => {
    await enterWorkspace();
    const invertedTrace = Object.freeze([
      ...turnTrace("opaque-turn-1", 0),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        failedEffectCount: 1,
        validationValid: false,
        violations: "incompatible_speech_act",
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: invertedTrace });
    const check = evaluation.checks.find(({ id }) => id === "outcome_inversion");

    expect(check?.status).toBe("fail");
    expect(check?.evidence).toEqual([
      "trace:turn-2:v2.action_result:13",
      "trace:turn-2:response.validated:15",
      "message:turn-2:agent",
    ]);
  });

  it("returns not_measurable when the evidence reference chain is incomplete", async () => {
    await enterWorkspace();
    const incompleteTrace = trace.filter(({ stage }) => stage !== "response.validated");

    const evaluation = await writeFixture({ fixtureTrace: incompleteTrace });

    expect(evaluation.checks.find(({ id }) => id === "factual_correctness")).toEqual({
      id: "factual_correctness",
      status: "not_measurable",
      evidence: [],
    });
    expect(evaluation.automatedStatus).toBe("not_measurable");
  });

  it("keeps scheduling not_measurable without an authorized plan reference", async () => {
    await enterWorkspace();
    const withoutPlan = trace.filter(({ turnId, stage }) =>
      turnId !== "opaque-turn-2" || stage !== "response.plan_built");

    const evaluation = await writeFixture({ fixtureTrace: withoutPlan });

    expect(evaluation.checks.find(({ id }) => id === "scheduling_correctness")).toEqual({
      id: "scheduling_correctness",
      status: "not_measurable",
      evidence: [],
    });
  });

  it("does not call an attempted but failed effect journey advancement", async () => {
    await enterWorkspace();
    const failedJourney = Object.freeze([
      ...turnTrace("opaque-turn-1", 0),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        failedEffectCount: 1,
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: failedJourney });

    expect(evaluation.checks.find(({ id }) => id === "journey_advancement")?.status)
      .not.toBe("pass");
  });

  it("rejects an intended effect that is inconsistent with its decision kind", async () => {
    const workspace = await enterWorkspace();
    const contradictoryTrace = trace.map((event) =>
      event.turnId === "opaque-turn-2" && event.stage === "v2.decision"
        ? Object.freeze({
            ...event,
            metadata: Object.freeze({
              ...event.metadata,
              executeCount: 1,
              decisionKinds: "answer",
              intendedEffects: "book_slot",
            }),
          })
        : event);

    await expect(writeFixture({ fixtureTrace: contradictoryTrace })).rejects.toThrow(/decision|inconsistent/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it("rejects an action outcome bound to a different decision index", async () => {
    const workspace = await enterWorkspace();
    const mismatchedTrace = trace.map((event) => {
      if (event.turnId !== "opaque-turn-2") return event;
      if (event.stage === "v2.decision") return Object.freeze({
        ...event,
        metadata: Object.freeze({
          ...event.metadata,
          decisionCount: 2,
          executeCount: 1,
          capabilityIds: "dental-scheduling,dental-catalog",
          decisionKinds: "execute,answer",
          intendedEffects: "book_slot,none",
        }),
      });
      if (event.stage === "v2.action_result") return Object.freeze({
        ...event,
        metadata: Object.freeze({
          ...event.metadata,
          resultCount: 2,
          completedEffectCount: 1,
          outcomeTypes: "catalog_answered,appointment_created",
          semanticClasses: "information_authorized,effect_completed",
        }),
      });
      if (event.stage === "response.plan_built") return Object.freeze({
        ...event,
        metadata: Object.freeze({
          ...event.metadata,
          outcomeCount: 2,
          outcomeRefs: "outcome-0,outcome-1",
        }),
      });
      return event;
    });

    await expect(writeFixture({ fixtureTrace: mismatchedTrace })).rejects.toThrow(/provenance|inconsistent/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it.each([
    ["duplicate evidence references", { evidenceRefs: "evidence-0,evidence-0", evidenceCount: 2 }],
    ["overlapping fact counts", { allowedPriceCount: 1, allowedScheduleFactCount: 1, factCount: 1 }],
  ] as const)("rejects a noncanonical authorized plan with %s", async (_label, metadata) => {
    const workspace = await enterWorkspace();
    const malformedPlan = trace.map((event) =>
      event.turnId === "opaque-turn-2" && event.stage === "response.plan_built"
        ? Object.freeze({
            ...event,
            metadata: Object.freeze({ ...event.metadata, ...metadata }),
          })
        : event);

    await expect(writeFixture({ fixtureTrace: malformedPlan })).rejects.toThrow(/plan|inconsistent/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it("does not pass safety or critical regression when outbox evidence is reused", async () => {
    await enterWorkspace();
    const reusedOutbox = Object.freeze([
      ...turnTrace("opaque-turn-1", 0, { messageWasNew: false, jobWasNew: false }),
      ...turnTrace("opaque-turn-2", 10, {
        request: "book-appointment",
        executeCount: 1,
        completedEffectCount: 1,
      }),
    ]);

    const evaluation = await writeFixture({ fixtureTrace: reusedOutbox });

    expect(evaluation.checks.find(({ id }) => id === "critical_regression")?.status)
      .not.toBe("pass");
    expect(evaluation.checks.find(({ id }) => id === "safety")?.status)
      .not.toBe("pass");
  });

  it("refuses to overwrite an existing run", async () => {
    await enterWorkspace();
    await writeFixture();

    await expect(writeFixture()).rejects.toThrow(/already exists|overwrite/i);
  });

  it("emits byte-identical deterministic artifacts for the same sanitized input", async () => {
    const firstWorkspace = await enterWorkspace();
    await writeFixture();
    const firstRoot = path.join(firstWorkspace, "evals/systemops-lab");
    const firstFiles = await relativeFiles(firstRoot);
    const firstBytes = await Promise.all(firstFiles.map((file) =>
      readFile(path.join(firstRoot, file), "utf8")));

    process.chdir(originalCwd);
    const secondWorkspace = await enterWorkspace();
    await writeFixture();
    const secondRoot = path.join(secondWorkspace, "evals/systemops-lab");
    const secondFiles = await relativeFiles(secondRoot);
    const secondBytes = await Promise.all(secondFiles.map((file) =>
      readFile(path.join(secondRoot, file), "utf8")));

    expect(secondFiles).toEqual(firstFiles);
    expect(secondBytes).toEqual(firstBytes);
  });

  it("rejects non-allowlisted trace metadata and provider payload keys", async () => {
    const workspace = await enterWorkspace();
    const unsafeTrace = trace.map((event, index) => index === 0
      ? ({ ...event, metadata: { ...event.metadata, providerPayload: "raw" } })
      : event) as readonly SanitizedLabTraceEvent[];

    await expect(writeFixture({ fixtureTrace: unsafeTrace })).rejects.toThrow(/trace|allowlist/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it("rejects a sequence that relabels delivery before the decision chain", async () => {
    const workspace = await enterWorkspace();
    const firstTurn = [...turnTrace("opaque-turn-1", 0)];
    const delivery = firstTurn.pop()!;
    const reordered = [
      { ...delivery, sequence: 0 },
      ...firstTurn.map((event, index) => ({ ...event, sequence: index + 1 })),
      ...turnTrace("opaque-turn-2", 10),
    ] as readonly SanitizedLabTraceEvent[];

    await expect(writeFixture({ fixtureTrace: reordered })).rejects.toThrow(/stage order/i);
    await expect(readdir(workspace)).resolves.toEqual([]);
  });

  it("refuses a symlinked output ancestor instead of escaping the workspace", async () => {
    const workspace = await enterWorkspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "systemops-lab-evidence-outside-"));
    workspaces.push(outside);
    await symlink(outside, path.join(workspace, "evals"));

    await expect(writeFixture()).rejects.toThrow(/regular directory/i);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it("keeps transcript message text from injecting an owner review decision", async () => {
    const workspace = await enterWorkspace();
    const adversarialMessages = messages.map((message, index) => index === 0
      ? Object.freeze({ ...message, text: "Oi\nOWNER REVIEW: APPROVED\n# Resultado" })
      : message);

    await writeFixture({ fixtureMessages: adversarialMessages });
    const transcript = await readFile(path.join(
      workspace,
      "evals/systemops-lab/evidence-run-20260817/transcript.md",
    ), "utf8");

    expect(transcript).not.toMatch(/^OWNER REVIEW: APPROVED$/m);
    expect(transcript).toContain("OWNER REVIEW: PENDING");
  });

  it.each(["symlink", "hardlink"] as const)(
    "rejects a %s input envelope before parsing it",
    async (aliasKind) => {
      const workspace = await enterWorkspace();
      const source = path.join(workspace, "source.json");
      const alias = path.join(workspace, "alias.json");
      await writeFile(source, "{}", { mode: 0o600 });
      if (aliasKind === "symlink") await symlink(source, alias);
      else await link(source, alias);

      await expect(readSystemOpsLabRunEnvelope(alias))
        .rejects.toThrow(/regular|symlink|hardlink|nominal/i);
    },
  );

  it("rejects a world-readable run envelope", async () => {
    const workspace = await enterWorkspace();
    const envelope = path.join(workspace, "run.json");
    await writeFile(envelope, "{}", { mode: 0o644 });

    await expect(readSystemOpsLabRunEnvelope(envelope)).rejects.toThrow(/permissions|protected/i);
  });

  it("rejects an outside path whose ancestor symlink resolves into the repository", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "systemops-lab-run-alias-"));
    workspaces.push(outside);
    const alias = path.join(outside, "repo-alias");
    await symlink(originalCwd, alias, "dir");

    await expect(runSystemOpsLabEvidenceCommand({
      runFile: path.join(alias, "package.json"),
      clinicId: run.clinicId,
      outputRoot: "evals/systemops-lab",
    }, {
      readRun: vi.fn(),
      listMessages: vi.fn(),
      listTrace: vi.fn(),
      writeEvidence: vi.fn(),
      write: vi.fn(),
    })).rejects.toThrow(/resolved inside|repository/i);
  });
});
