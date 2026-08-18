import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  assertSystemOpsLabRunId,
  parseSystemOpsLabPersona,
  runSystemOpsLabPersona,
  type SystemOpsLabPersona,
  type SystemOpsLabRunResult,
} from "@/application/labs/systemops-lab-persona";

export type SystemOpsLabPersonaCommand = Readonly<{
  mode: "dry-run" | "execute";
  runId: string;
  clinicId: string;
  personaPath: string;
  approvalFile: string;
  resultFile: string | null;
}>;

type SystemOpsLabPersonaCommandDependencies = Readonly<{
  loadPersona(path: string): Promise<SystemOpsLabPersona>;
  readApproval(path: string): Promise<string>;
  execute(input: Readonly<{
    command: SystemOpsLabPersonaCommand;
    persona: SystemOpsLabPersona;
    serializedApproval: string;
  }>): Promise<SystemOpsLabRunResult>;
  reserveResultFile(path: string): Promise<SystemOpsLabRunResultReservation>;
  write(line: string): void;
}>;

export type SystemOpsLabRunResultReservation = Readonly<{
  publish(result: SystemOpsLabRunResult): Promise<void>;
  release(): Promise<void>;
}>;

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flagValue(argv: readonly string[], flag: string): string | null {
  const indexes = argv.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} must be provided once`);
  if (indexes.length === 0) return null;
  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseSystemOpsLabPersonaCommandArgs(
  argv: readonly string[],
): SystemOpsLabPersonaCommand {
  const modes = ["--dry-run", "--execute"].filter((flag) => argv.includes(flag));
  if (modes.length !== 1) throw new Error("exactly one mode is required");
  const runId = flagValue(argv, "--run-id");
  const clinicId = flagValue(argv, "--clinic-id");
  const personaPath = flagValue(argv, "--persona");
  const approvalFile = flagValue(argv, "--approval-file");
  const resultFile = flagValue(argv, "--result-file");
  if (!runId) throw new Error("--run-id is required");
  assertSystemOpsLabRunId(runId);
  if (!clinicId || !uuidPattern.test(clinicId)) {
    throw new Error("--clinic-id must be an exact UUID");
  }
  if (!personaPath || path.extname(personaPath).toLowerCase() !== ".json") {
    throw new Error("--persona must point to a JSON file");
  }
  if (!approvalFile) throw new Error("--approval-file is required");
  const mode = modes[0] === "--dry-run" ? "dry-run" : "execute";
  if (mode === "execute" && !resultFile) {
    throw new Error("--result-file is required in execute mode");
  }
  if (mode === "dry-run" && resultFile) {
    throw new Error("--result-file is not accepted in dry-run mode");
  }
  if (resultFile) {
    if (!path.isAbsolute(resultFile)) throw new Error("--result-file must be absolute");
    if (!outsideRepository(path.resolve(resultFile))) {
      throw new Error("--result-file must be outside the repository and final evidence root");
    }
  }

  const valueFlags = new Set([
    "--run-id",
    "--clinic-id",
    "--persona",
    "--approval-file",
    "--result-file",
  ]);
  const booleanFlags = new Set(["--dry-run", "--execute"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (booleanFlags.has(flag)) continue;
    if (!valueFlags.has(flag)) throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  return Object.freeze({
    mode,
    runId,
    clinicId,
    personaPath,
    approvalFile,
    resultFile,
  });
}

const runResultSchema = z.object({
  runId: z.string().min(4).max(64),
  clinicId: z.string().regex(uuidPattern),
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

function canonicalizeRunResult(result: SystemOpsLabRunResult): SystemOpsLabRunResult {
  const parsed = runResultSchema.parse(result);
  assertSystemOpsLabRunId(parsed.runId);
  const identities = parsed.turns.flatMap((turn) => [
    turn.turnId,
    turn.leadMessageId,
    turn.outboundMessageId,
    turn.persistedAgentMessageId,
  ]);
  if (new Set(identities).size !== identities.length) {
    throw new Error("SystemOps Lab run result contains duplicate persistence identities");
  }
  return Object.freeze({
    ...parsed,
    turns: Object.freeze(parsed.turns.map((turn) => Object.freeze({ ...turn }))),
  });
}

function outsideRepository(target: string): boolean {
  const relative = path.relative(repositoryRoot, target);
  return relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
}

export async function writeSystemOpsLabRunResultFile(
  resultFile: string,
  result: SystemOpsLabRunResult,
): Promise<void> {
  if (!path.isAbsolute(resultFile)) throw new Error("run result file path must be absolute");
  const canonicalParent = await realpath(path.dirname(resultFile));
  const target = path.join(canonicalParent, path.basename(resultFile));
  if (!outsideRepository(target)) {
    throw new Error("run result file must remain outside the repository and final evidence root");
  }
  try {
    await lstat(target);
    throw new Error("SystemOps Lab run result already exists; overwrite refused");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const canonical = canonicalizeRunResult(result);
  const serialized = `${JSON.stringify(canonical, null, 2)}\n`;
  const temporary = path.join(
    canonicalParent,
    `.${path.basename(resultFile)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let published = false;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    const beforeLink = await handle.stat();
    if (!beforeLink.isFile() || beforeLink.nlink !== 1) {
      throw new Error("SystemOps Lab run result temporary file is not nominal");
    }
    await link(temporary, target);
    published = true;
    const linked = await lstat(target);
    if (
      !linked.isFile()
      || linked.isSymbolicLink()
      || linked.dev !== beforeLink.dev
      || linked.ino !== beforeLink.ino
      || linked.nlink !== 2
    ) throw new Error("SystemOps Lab run result publication identity changed");
    await unlink(temporary);
    await handle.close();
    handle = null;
    const finalStat = await lstat(target);
    if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1) {
      throw new Error("SystemOps Lab run result final file is not nominal");
    }
  } catch (error) {
    if (published) await unlink(target).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("SystemOps Lab run result already exists; overwrite refused");
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function reserveSystemOpsLabRunResultFile(
  resultFile: string,
): Promise<SystemOpsLabRunResultReservation> {
  if (!path.isAbsolute(resultFile)) throw new Error("run result file path must be absolute");
  const canonicalParent = await realpath(path.dirname(resultFile));
  const target = path.join(canonicalParent, path.basename(resultFile));
  if (!outsideRepository(target)) {
    throw new Error("run result file must remain outside the repository and final evidence root");
  }
  try {
    await lstat(target);
    throw new Error("SystemOps Lab run result already exists; overwrite refused");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const reservationPath = `${target}.reservation`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let reservationIdentity: Readonly<{ dev: number; ino: number }> | null = null;
  try {
    handle = await open(
      reservationPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const reservedStat = await handle.stat();
    if (!reservedStat.isFile() || reservedStat.nlink !== 1) {
      throw new Error("SystemOps Lab run result reservation is not nominal");
    }
    reservationIdentity = { dev: reservedStat.dev, ino: reservedStat.ino };
    try {
      await lstat(target);
      throw new Error("SystemOps Lab run result already exists; overwrite refused");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    let released = false;
    let published = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      await handle?.close();
      handle = null;
      const current = await lstat(reservationPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (
        current
        && current.isFile()
        && !current.isSymbolicLink()
        && current.dev === reservedStat.dev
        && current.ino === reservedStat.ino
      ) await unlink(reservationPath);
    };
    return Object.freeze({
      publish: async (result: SystemOpsLabRunResult): Promise<void> => {
        if (released) throw new Error("SystemOps Lab run result reservation was released");
        if (published) throw new Error("SystemOps Lab run result was already published");
        await writeSystemOpsLabRunResultFile(target, result);
        published = true;
      },
      release,
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (reservationIdentity) {
      const current = await lstat(reservationPath).catch(() => null);
      if (
        current?.isFile()
        && !current.isSymbolicLink()
        && current.dev === reservationIdentity.dev
        && current.ino === reservationIdentity.ino
      ) await unlink(reservationPath).catch(() => undefined);
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("SystemOps Lab run result destination is already reserved");
    }
    throw error;
  }
}

async function loadPersonaFile(personaPath: string): Promise<SystemOpsLabPersona> {
  const serialized = await readFile(personaPath, "utf8");
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1_024) {
    throw new Error("SystemOps Lab persona JSON exceeds the closed file limit");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch {
    throw new Error("SystemOps Lab persona JSON is invalid");
  }
  return parseSystemOpsLabPersona(decoded);
}

function sanitizedCommandSummary(
  command: SystemOpsLabPersonaCommand,
  persona: SystemOpsLabPersona,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: command.mode,
    runId: command.runId,
    clinicId: command.clinicId,
    personaId: persona.personaId,
    scenario: persona.scenario,
    turnCount: persona.turns.length,
    expectedCheckCount: new Set(persona.turns.flatMap((turn) => turn.expected)).size,
  });
}

export async function runSystemOpsLabPersonaCommand(
  command: SystemOpsLabPersonaCommand,
  dependencies: SystemOpsLabPersonaCommandDependencies,
): Promise<SystemOpsLabRunResult | null> {
  const persona = await dependencies.loadPersona(command.personaPath);
  if (command.mode === "dry-run") {
    dependencies.write(sanitizedCommandSummary(command, persona));
    return null;
  }
  const serializedApproval = await dependencies.readApproval(command.approvalFile);
  if (!serializedApproval.trim()) throw new Error("Internal Lab approval file is empty");
  const reservation = await dependencies.reserveResultFile(command.resultFile!);
  try {
    const result = await dependencies.execute({ command, persona, serializedApproval });
    const canonicalResult = canonicalizeRunResult(result);
    if (
      canonicalResult.runId !== command.runId
      || canonicalResult.clinicId !== command.clinicId
      || canonicalResult.personaId !== persona.personaId
      || canonicalResult.turns.length !== persona.turns.length
    ) throw new Error("SystemOps Lab run result does not match the execute command");
    await reservation.publish(canonicalResult);
    dependencies.write(JSON.stringify({
      schemaVersion: 1,
      mode: command.mode,
      runId: canonicalResult.runId,
      personaId: canonicalResult.personaId,
      turnCount: canonicalResult.turns.length,
      capturedCount: canonicalResult.turns.filter((turn) => turn.captured).length,
    }));
    return canonicalResult;
  } finally {
    await reservation.release();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`SystemOps Lab persona runner requires ${name}`);
  return value;
}

async function executeDurablePersona(input: Readonly<{
  command: SystemOpsLabPersonaCommand;
  persona: SystemOpsLabPersona;
  serializedApproval: string;
}>): Promise<SystemOpsLabRunResult> {
  if (requiredEnvironment("SYSTEMOPS_LAB_CLINIC_ID") !== input.command.clinicId) {
    throw new Error("SystemOps Lab persona tenant does not match the configured target");
  }
  requiredEnvironment("OPENAI_API_KEY");
  const configuredApproval = process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON;
  if (configuredApproval?.trim() && configuredApproval !== input.serializedApproval) {
    throw new Error("SystemOps Lab persona approval file does not match the deployed configuration");
  }
  process.env.CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON = input.serializedApproval;

  const [
    { parseAndRegisterDeployedInternalLabApproval },
    { createConfiguredCycleIRuntimeBuildIdentity },
    {
      loadConfiguredInternalLabAuthority,
      loadConfiguredInternalLabDeploymentIdentity,
    },
    { createConversationV2Runtime },
    { DrizzleInternalLabRuntimeBindingsReader },
    { DrizzleInboundEventStore },
    { DrizzleJobQueue },
    { DrizzleOutboundMessageStore },
    { DrizzleOutboundSafetyContextReader },
    { DrizzleConversationRepository },
    { ProcessMessageJobHandler },
    { SendMessageJobHandler },
    { ReplayOutboundCapture },
    {
      createInternalLabSyntheticAddress,
      registerInternalLabSyntheticRun,
    },
    { listConversationMessages },
    { listClinicConversations },
  ] = await Promise.all([
    import("@/application/conversation-v2/internal-lab-approval"),
    import("@/application/conversation-v2/configured-cycle-i-authority"),
    import("@/infrastructure/conversation-v2/configured-internal-lab-authority"),
    import("@/infrastructure/conversation-v2/create-conversation-v2-runtime"),
    import("@/infrastructure/conversation-v2/drizzle-internal-lab-runtime-bindings-reader"),
    import("@/infrastructure/repositories/drizzle-inbound-event-store"),
    import("@/infrastructure/repositories/drizzle-job-queue"),
    import("@/infrastructure/repositories/drizzle-outbound-message-store"),
    import("@/infrastructure/repositories/drizzle-outbound-safety-context-reader"),
    import("@/infrastructure/repositories/drizzle-conversation-repository"),
    import("@/application/jobs/process-message-job"),
    import("@/application/jobs/send-message-job"),
    import("@/application/replay/replay-outbound-capture"),
    import("@/application/labs/internal-lab-synthetic-delivery"),
    import("@/application/inbox/list-messages"),
    import("@/application/inbox/list-conversations"),
  ]);

  const runtimeBindingsReader = new DrizzleInternalLabRuntimeBindingsReader();
  const currentBindings = await runtimeBindingsReader.resolve(input.command.clinicId);
  const expectedBindings = {
    tenantDigest: requiredEnvironment("CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST"),
    channelDigest: requiredEnvironment("CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST"),
    configDigest: requiredEnvironment("CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST"),
  } as const;
  for (const field of ["tenantDigest", "channelDigest", "configDigest"] as const) {
    if (currentBindings[field] !== expectedBindings[field]) {
      throw new Error(`SystemOps Lab persona current ${field} does not match configuration`);
    }
  }
  const runtimeIdentity = createConfiguredCycleIRuntimeBuildIdentity();
  const approval = parseAndRegisterDeployedInternalLabApproval({
    serializedApproval: input.serializedApproval,
    authority: loadConfiguredInternalLabAuthority(),
    runtimeIdentity,
    deploymentIdentity: loadConfiguredInternalLabDeploymentIdentity(),
    expectedTenantDigest: currentBindings.tenantDigest,
    expectedChannelDigest: currentBindings.channelDigest,
    expectedConfigDigest: currentBindings.configDigest,
    expectedClinicId: input.command.clinicId,
    now: new Date(),
  });
  const authorizationBindings = Object.freeze({
    approval,
    runtimeIdentity,
    expectedClinicId: input.command.clinicId,
    expectedTenantDigest: currentBindings.tenantDigest,
    expectedChannelDigest: currentBindings.channelDigest,
    expectedConfigDigest: currentBindings.configDigest,
    now: () => new Date(),
  });
  const jobQueue = new DrizzleJobQueue();
  const inboundEventStore = new DrizzleInboundEventStore();
  const outboundMessageStore = new DrizzleOutboundMessageStore();
  const runtime = createConversationV2Runtime({
    jobQueue,
    outboundMessageStore,
    runtimeBindingsReader,
    authorizationBindings,
  });
  const syntheticAddress = createInternalLabSyntheticAddress({
    runId: input.command.runId,
    personaId: input.persona.personaId,
  });
  const syntheticAuthorization = registerInternalLabSyntheticRun({
    approval,
    clinicId: input.command.clinicId,
    runId: input.command.runId,
    addresses: [syntheticAddress],
  });
  const capture = new ReplayOutboundCapture();
  const processMessageHandler = new ProcessMessageJobHandler({
    inboundEventStore,
    automationPolicy: runtime.automationPolicy,
    conversationHandler: runtime.conversationHandler,
    transcribeAudio: async () => {
      throw new Error("SystemOps Lab persona runner accepts text turns only");
    },
    decisionTraceSink: runtime.decisionTraceSink,
    createTurnObservationSink: runtime.createTurnObservationSink,
  });
  const sendMessageHandler = new SendMessageJobHandler({
    outboundMessageStore,
    safetyContextReader: new DrizzleOutboundSafetyContextReader(),
    conversationRepository: new DrizzleConversationRepository(),
    decisionTraceSink: runtime.decisionTraceSink,
    internalLabDeliveryGuard: runtime.internalLabDeliveryGuard,
    internalLabSyntheticRunAuthorization: syntheticAuthorization,
    outboundBoundary: capture.createBoundary(),
  });
  const isolationClinicId = input.command.clinicId === "00000000-0000-4000-8000-000000000000"
    ? "ffffffff-ffff-4fff-bfff-ffffffffffff"
    : "00000000-0000-4000-8000-000000000000";

  return runSystemOpsLabPersona({
    runId: input.command.runId,
    clinicId: input.command.clinicId,
    persona: input.persona,
    dependencies: {
      inboundEventStore,
      jobQueue,
      processMessageHandler,
      outboundMessageStore,
      sendMessageHandler,
      listConversationMessages,
      listClinicConversations: async ({ clinicId, ids }) => {
        const result = await listClinicConversations({ clinicId, ids });
        return {
          rows: result.rows.map((row) => ({ convId: row.convId, leadId: row.leadId })),
          nextCursor: result.nextCursor,
        };
      },
      deliveryAudit: {
        capturedDestinations: () => capture.effects
          .filter((effect) => effect.kind !== "suppressed")
          .map((effect) => effect.to),
        // The runner supplies no real provider boundary; Task 9 routes the
        // exact registered synthetic address only through the nominal capture.
        externalProviderCallCount: () => 0,
      },
      isolationClinicId,
      now: () => new Date(),
    },
  });
}

const defaultDependencies: SystemOpsLabPersonaCommandDependencies = {
  loadPersona: loadPersonaFile,
  readApproval: (approvalPath) => readFile(approvalPath, "utf8"),
  execute: executeDurablePersona,
  reserveResultFile: reserveSystemOpsLabRunResultFile,
  write: (line) => process.stdout.write(`${line}\n`),
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSystemOpsLabPersonaCommand(
    parseSystemOpsLabPersonaCommandArgs(process.argv.slice(2)),
    defaultDependencies,
  ).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "SystemOps Lab persona runner failed"}\n`);
    process.exitCode = 1;
  });
}
