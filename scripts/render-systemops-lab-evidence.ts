import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  writeSystemOpsLabEvidence,
  type SanitizedLabTraceEvent,
  type SanitizedTranscriptMessage,
  type SystemOpsLabEvaluation,
} from "@/application/labs/systemops-lab-evidence";
import type { SystemOpsLabRunResult } from "@/application/labs/systemops-lab-persona";
import type { DecisionTraceRecord } from "@/core/observability/DecisionTrace";

export type SystemOpsLabEvidenceCommand = Readonly<{
  runFile: string;
  clinicId: string;
  outputRoot: "evals/systemops-lab";
}>;

type PersistedMessage = Readonly<{
  id: string;
  conversationId: string;
  author: "lead" | "clinic_user" | "agent" | "system";
  body: string;
}>;

type PersistedTraceBatch = Readonly<{
  turnId: string;
  clinicId: string;
  conversationId: string | null;
  events: readonly DecisionTraceRecord[];
}>;

export type SystemOpsLabEvidenceCommandDependencies = Readonly<{
  readRun(file: string): Promise<unknown>;
  listMessages(input: Readonly<{ clinicId: string; conversationId: string }>): Promise<Readonly<{
    messages: readonly PersistedMessage[];
    hasMore: boolean;
  }>>;
  listTrace(input: Readonly<{ clinicId: string; conversationId: string }>): Promise<readonly PersistedTraceBatch[]>;
  writeEvidence(input: Readonly<{
    outputRoot: "evals/systemops-lab";
    run: SystemOpsLabRunResult;
    messages: readonly SanitizedTranscriptMessage[];
    trace: readonly SanitizedLabTraceEvent[];
  }>): Promise<SystemOpsLabEvaluation>;
  write(line: string): void;
}>;

const uuidSchema = z.string().uuid();
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runSchema = z.object({
  runId: z.string().min(4).max(64),
  clinicId: uuidSchema,
  personaId: z.string().min(1).max(48),
  conversationId: z.string().min(1).max(240),
  turns: z.array(z.object({
    turnId: z.string().min(1).max(240),
    leadMessageId: z.string().min(1).max(240),
    outboundMessageId: z.string().min(1).max(240),
    persistedAgentMessageId: z.string().min(1).max(240),
    captured: z.literal(true),
  }).strict()).min(1).max(8),
}).strict();

const evidenceStages = new Set([
  "engine.selected",
  "v2.understanding",
  "v2.decision",
  "v2.action_result",
  "response.plan_built",
  "response.validated",
  "response.fallback_applied",
  "v2.outbox",
  "delivery.sent",
  "turn.failed",
]);

function flagValue(argv: readonly string[], flag: string): string {
  const indexes = argv.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length !== 1) throw new Error(`${flag} must be provided exactly once`);
  const value = argv[indexes[0]! + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function outsideRepository(target: string): boolean {
  const relative = path.relative(repositoryRoot, target);
  return relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
}

export function parseSystemOpsLabEvidenceCommandArgs(
  argv: readonly string[],
): SystemOpsLabEvidenceCommand {
  const valueFlags = new Set(["--run-file", "--clinic-id", "--output-root"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!valueFlags.has(flag)) throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  const outputRoot = flagValue(argv, "--output-root");
  if (outputRoot !== "evals/systemops-lab") {
    throw new Error("--output-root must be evals/systemops-lab");
  }
  const clinicId = uuidSchema.parse(flagValue(argv, "--clinic-id"));
  const runFile = flagValue(argv, "--run-file");
  if (!path.isAbsolute(runFile) || !outsideRepository(path.resolve(runFile))) {
    throw new Error("--run-file must be an absolute protected handoff outside the repository");
  }
  return Object.freeze({
    runFile,
    clinicId,
    outputRoot,
  });
}

export async function readSystemOpsLabRunEnvelope(file: string): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let serialized: string;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error("SystemOps Lab evidence input must be a nominal regular single-link file");
    }
    if ((before.mode & 0o077) !== 0) {
      throw new Error("SystemOps Lab evidence input must have protected owner-only permissions");
    }
    if (before.size > 2 * 1_024 * 1_024) {
      throw new Error("SystemOps Lab evidence input exceeds the closed file limit");
    }
    serialized = await handle.readFile("utf8");
    const after = await handle.stat();
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.nlink !== 1
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
    ) throw new Error("SystemOps Lab evidence input changed while being read");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error("SystemOps Lab evidence input must not be a symlink");
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("SystemOps Lab evidence input is not valid JSON");
  }
}

function persistedMessagesForRun(
  run: z.infer<typeof runSchema>,
  result: Awaited<ReturnType<SystemOpsLabEvidenceCommandDependencies["listMessages"]>>,
): readonly SanitizedTranscriptMessage[] {
  if (result.hasMore) throw new Error("SystemOps Lab evidence refuses a partial persisted message page");
  const expected = run.turns.flatMap((turn) => [
    { turnId: turn.turnId, id: turn.leadMessageId, author: "lead" as const },
    { turnId: turn.turnId, id: turn.persistedAgentMessageId, author: "agent" as const },
  ]);
  if (result.messages.length !== expected.length) {
    throw new Error("SystemOps Lab evidence persisted message set has missing or extra rows");
  }
  return Object.freeze(expected.map((item, index) => {
    const persisted = result.messages[index];
    if (
      !persisted
      || persisted.id !== item.id
      || persisted.author !== item.author
      || persisted.conversationId !== run.conversationId
    ) throw new Error("SystemOps Lab evidence persisted message provenance does not match the run");
    return Object.freeze({
      turnId: item.turnId,
      messageId: persisted.id,
      author: item.author,
      text: persisted.body,
    });
  }));
}

function persistedTraceForRun(
  run: z.infer<typeof runSchema>,
  batches: readonly PersistedTraceBatch[],
): readonly SanitizedLabTraceEvent[] {
  const expectedTurnIds = run.turns.map(({ turnId }) => turnId);
  if (
    batches.length !== expectedTurnIds.length
    || new Set(batches.map(({ turnId }) => turnId)).size !== batches.length
    || batches.some(({ turnId }) => !expectedTurnIds.includes(turnId))
  ) throw new Error("SystemOps Lab evidence Decision Trace has missing or extra run turns");

  return Object.freeze(run.turns.flatMap((turn) => {
    const batch = batches.find(({ turnId }) => turnId === turn.turnId)!;
    if (batch.clinicId !== run.clinicId || batch.conversationId !== run.conversationId) {
      throw new Error("SystemOps Lab evidence Decision Trace crossed the tenant or conversation boundary");
    }
    const filtered = batch.events.filter(({ stage }) => evidenceStages.has(stage));
    return filtered.map((event, sequence) => {
      if (
        event.turnId !== turn.turnId
        || (event.clinicId !== undefined && event.clinicId !== run.clinicId)
        || (event.conversationId !== undefined && event.conversationId !== run.conversationId)
      ) throw new Error("SystemOps Lab evidence Decision Trace event provenance is inconsistent");
      if (event.stage === "delivery.sent" && (
        event.metadata?.providerAccepted !== true
        || event.metadata.outboundMessageId !== turn.outboundMessageId
      )) {
        throw new Error("SystemOps Lab evidence delivery trace does not prove the exact captured outbound");
      }
      return Object.freeze({
        schemaVersion: "decision-trace.v1" as const,
        turnId: turn.turnId,
        sequence,
        stage: event.stage,
        occurredAt: event.occurredAt,
        metadata: event.stage === "delivery.sent"
          ? Object.freeze({ status: "captured" as const })
          : Object.freeze({ ...(event.metadata ?? {}) }),
      }) as SanitizedLabTraceEvent;
    });
  }));
}

async function defaultDependencies(): Promise<SystemOpsLabEvidenceCommandDependencies> {
  const [{ listConversationMessages }, { DrizzleDecisionTraceStore }] = await Promise.all([
    import("@/application/inbox/list-messages"),
    import("@/infrastructure/repositories/drizzle-decision-trace-store"),
  ]);
  const traceStore = new DrizzleDecisionTraceStore();
  return Object.freeze({
    readRun: readSystemOpsLabRunEnvelope,
    listMessages: listConversationMessages,
    listTrace: ({ clinicId, conversationId }) =>
      traceStore.listByConversation(clinicId, conversationId),
    writeEvidence: writeSystemOpsLabEvidence,
    write: (line) => process.stdout.write(`${line}\n`),
  });
}

export async function runSystemOpsLabEvidenceCommand(
  command: SystemOpsLabEvidenceCommand,
  injectedDependencies?: SystemOpsLabEvidenceCommandDependencies,
): Promise<void> {
  if (!path.isAbsolute(command.runFile) || !outsideRepository(path.resolve(command.runFile))) {
    throw new Error("SystemOps Lab evidence run file must be a protected handoff outside the repository");
  }
  const canonicalTarget = path.join(
    await realpath(path.dirname(command.runFile)),
    path.basename(command.runFile),
  );
  if (!outsideRepository(canonicalTarget)) {
    throw new Error("SystemOps Lab evidence run file resolved inside the repository");
  }
  const dependencies = injectedDependencies ?? await defaultDependencies();
  const run = runSchema.parse(await dependencies.readRun(canonicalTarget));
  if (run.clinicId !== command.clinicId) {
    throw new Error("SystemOps Lab evidence run tenant does not match --clinic-id");
  }
  const [messageResult, traceBatches] = await Promise.all([
    dependencies.listMessages({ clinicId: command.clinicId, conversationId: run.conversationId }),
    dependencies.listTrace({ clinicId: command.clinicId, conversationId: run.conversationId }),
  ]);
  const messages = persistedMessagesForRun(run, messageResult);
  const trace = persistedTraceForRun(run, traceBatches);
  const evaluation = await dependencies.writeEvidence({
    outputRoot: command.outputRoot,
    run,
    messages,
    trace,
  });
  dependencies.write(JSON.stringify({
    schemaVersion: 1,
    runId: evaluation.runId,
    personaId: evaluation.personaId,
    automatedStatus: evaluation.automatedStatus,
    humanReview: evaluation.humanReview,
    ownerReview: evaluation.ownerReview,
    artifactCount: 4,
  }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runSystemOpsLabEvidenceCommand(parseSystemOpsLabEvidenceCommandArgs(process.argv.slice(2)))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    });
}
