import type {
  ConversationAuthorityStore,
  ConversationAuthorityVersion,
} from "@/application/ports/conversation-authority-store";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import {
  AUTHORITY_BLOCKING_VALIDATION_METRICS,
  AUTHORITY_VALIDATION_METRICS,
  assertUuid,
  validateWhatsAppStreamAuthority,
  type AuthorityValidationIssue,
  type AuthorityValidationMetric,
  type AuthorityValidationReport,
} from "./validate-whatsapp-stream-authority";

export type AuthorityActivationResult = Readonly<{
  activated: boolean;
  version: ConversationAuthorityVersion;
  unresolvedEvents: number;
}>;

export function assessWhatsAppStreamAuthorityTransition(input: Readonly<{
  expectedVersion: ConversationAuthorityVersion;
  nextVersion: ConversationAuthorityVersion;
  metrics: readonly AuthorityValidationIssue[];
}>): Readonly<{ unresolvedEvents: number }> {
  const metrics = new Map<AuthorityValidationMetric, number>();
  for (const metric of input.metrics) {
    if (!AUTHORITY_VALIDATION_METRICS.includes(metric.metric)) {
      throw new Error(`authority validation returned unknown metric: ${metric.metric}`);
    }
    if (metrics.has(metric.metric)) {
      throw new Error(`authority validation returned duplicate metric: ${metric.metric}`);
    }
    if (!Number.isSafeInteger(metric.count) || metric.count < 0) {
      throw new Error(`authority validation returned invalid count for ${metric.metric}`);
    }
    metrics.set(metric.metric, metric.count);
  }
  const missing = AUTHORITY_VALIDATION_METRICS.filter((metric) => !metrics.has(metric));
  if (missing.length > 0) {
    throw new Error(`authority validation omitted metrics: ${missing.join(", ")}`);
  }

  const unresolvedEvents = metrics.get("unresolved_events") ?? 0;
  const allowsUnresolvedMigrationDebt = input.expectedVersion === 0 && input.nextVersion === 1;
  const blocking = AUTHORITY_BLOCKING_VALIDATION_METRICS.flatMap((metric) => {
    const count = metrics.get(metric) ?? 0;
    if (count === 0 || (metric === "unresolved_events" && allowsUnresolvedMigrationDebt)) return [];
    return [`${metric}=${count}`];
  });
  if (blocking.length > 0) {
    throw new Error(`authority validation failed: ${blocking.join(", ")}`);
  }
  return { unresolvedEvents };
}

export async function activateWhatsAppStreamAuthority(input: Readonly<{
  clinicId: string;
  expectedVersion: ConversationAuthorityVersion;
  nextVersion: ConversationAuthorityVersion;
  actor: string;
  now: Date;
  store: ConversationAuthorityStore;
  validate: (clinicId: string) => Promise<AuthorityValidationReport>;
  apply?: boolean;
}>): Promise<AuthorityActivationResult> {
  assertUuid(input.clinicId, "clinic id");
  if (input.nextVersion <= input.expectedVersion) {
    throw new Error("authority activation cannot keep or lower a version");
  }
  if (input.nextVersion !== input.expectedVersion + 1) {
    throw new Error("authority activation must advance one version");
  }
  const current = await input.store.getVersion(input.clinicId);
  if (current !== input.expectedVersion) {
    return { activated: false, version: current, unresolvedEvents: 0 };
  }
  const validation = await input.validate(input.clinicId);
  const assessment = assessWhatsAppStreamAuthorityTransition({
    expectedVersion: input.expectedVersion,
    nextVersion: input.nextVersion,
    metrics: validation.metrics,
  });
  if (input.apply === false) {
    return {
      activated: false,
      version: current,
      unresolvedEvents: assessment.unresolvedEvents,
    };
  }
  const activated = await input.store.compareAndSetVersion({
    clinicId: input.clinicId,
    expectedVersion: input.expectedVersion,
    nextVersion: input.nextVersion,
    actor: input.actor,
    now: input.now,
  });
  return {
    activated,
    version: activated ? input.nextVersion : await input.store.getVersion(input.clinicId),
    unresolvedEvents: assessment.unresolvedEvents,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const clinicId = requiredValue("--clinic-id", argv);
  const expectedVersion = parseVersion(requiredValue("--expected-version", argv));
  const nextVersion = parseVersion(requiredValue("--next-version", argv));
  const actor = requiredValue("--actor", argv);
  const apply = argv.includes("--apply");
  const result = await activateWhatsAppStreamAuthority({
    clinicId,
    expectedVersion,
    nextVersion,
    actor,
    now: new Date(),
    store: new DrizzleConversationAuthorityStore(),
    validate: validateWhatsAppStreamAuthority,
    apply,
  });
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    clinicId,
    expectedVersion,
    nextVersion,
    ...result,
  })}\n`);
  if (apply ? !result.activated : result.version !== expectedVersion) process.exitCode = 1;
}

function requiredValue(flag: string, argv: readonly string[]): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function parseVersion(value: string): ConversationAuthorityVersion {
  const version = Number(value);
  if (version !== 0 && version !== 1 && version !== 2 && version !== 3) {
    throw new Error("authority version must be 0, 1, 2, or 3");
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "authority activation failed"}\n`);
    process.exitCode = 1;
  });
}
