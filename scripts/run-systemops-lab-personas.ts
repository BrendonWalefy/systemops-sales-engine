import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
}>;

type SystemOpsLabPersonaCommandDependencies = Readonly<{
  loadPersona(path: string): Promise<SystemOpsLabPersona>;
  readApproval(path: string): Promise<string>;
  execute(input: Readonly<{
    command: SystemOpsLabPersonaCommand;
    persona: SystemOpsLabPersona;
    serializedApproval: string;
  }>): Promise<SystemOpsLabRunResult>;
  write(line: string): void;
}>;

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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
  if (!runId) throw new Error("--run-id is required");
  assertSystemOpsLabRunId(runId);
  if (!clinicId || !uuidPattern.test(clinicId)) {
    throw new Error("--clinic-id must be an exact UUID");
  }
  if (!personaPath || path.extname(personaPath).toLowerCase() !== ".json") {
    throw new Error("--persona must point to a JSON file");
  }
  if (!approvalFile) throw new Error("--approval-file is required");

  const valueFlags = new Set(["--run-id", "--clinic-id", "--persona", "--approval-file"]);
  const booleanFlags = new Set(["--dry-run", "--execute"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (booleanFlags.has(flag)) continue;
    if (!valueFlags.has(flag)) throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  return Object.freeze({
    mode: modes[0] === "--dry-run" ? "dry-run" : "execute",
    runId,
    clinicId,
    personaPath,
    approvalFile,
  });
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
  const result = await dependencies.execute({ command, persona, serializedApproval });
  dependencies.write(JSON.stringify({
    schemaVersion: 1,
    mode: command.mode,
    runId: result.runId,
    personaId: result.personaId,
    conversationId: result.conversationId,
    turnCount: result.turns.length,
    capturedCount: result.turns.filter((turn) => turn.captured).length,
  }));
  return result;
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
