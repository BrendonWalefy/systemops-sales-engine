import type {
  ConversationAuthorityStore,
  ConversationAuthorityVersion,
} from "@/application/ports/conversation-authority-store";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DrizzleConversationAuthorityStore } from "@/infrastructure/repositories/drizzle-conversation-authority-store";
import { assertUuid, validateWhatsAppStreamAuthority } from "./validate-whatsapp-stream-authority";

export async function activateWhatsAppStreamAuthority(input: Readonly<{
  clinicId: string;
  expectedVersion: ConversationAuthorityVersion;
  nextVersion: ConversationAuthorityVersion;
  actor: string;
  now: Date;
  store: ConversationAuthorityStore;
  validate: (clinicId: string) => Promise<{ clean: boolean; issues: readonly string[] }>;
}>): Promise<{ activated: boolean; version: ConversationAuthorityVersion }> {
  assertUuid(input.clinicId, "clinic id");
  if (input.nextVersion <= input.expectedVersion) {
    throw new Error("authority activation cannot keep or lower a version");
  }
  if (input.nextVersion !== input.expectedVersion + 1) {
    throw new Error("authority activation must advance one version");
  }
  const current = await input.store.getVersion(input.clinicId);
  if (current !== input.expectedVersion) {
    return { activated: false, version: current };
  }
  const validation = await input.validate(input.clinicId);
  if (!validation.clean) {
    throw new Error(`authority validation failed: ${validation.issues.join(", ")}`);
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
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const clinicId = requiredValue("--clinic-id", argv);
  const expectedVersion = parseVersion(requiredValue("--expected-version", argv));
  const nextVersion = parseVersion(requiredValue("--next-version", argv));
  const actor = requiredValue("--actor", argv);
  const apply = argv.includes("--apply");
  const report = await validateWhatsAppStreamAuthority(clinicId);
  if (!report.clean) throw new Error(`authority validation failed: ${report.issues.join(", ")}`);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", clinicId, expectedVersion, nextVersion })}\n`);
    return;
  }
  const result = await activateWhatsAppStreamAuthority({
    clinicId,
    expectedVersion,
    nextVersion,
    actor,
    now: new Date(),
    store: new DrizzleConversationAuthorityStore(),
    validate: validateWhatsAppStreamAuthority,
  });
  process.stdout.write(`${JSON.stringify({ mode: "apply", ...result })}\n`);
  if (!result.activated) process.exitCode = 1;
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
