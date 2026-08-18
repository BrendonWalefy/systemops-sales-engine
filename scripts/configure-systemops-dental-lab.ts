import { constants } from "node:fs";
import { open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, ne, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getClinicModules } from "@/application/modules/module-gate";
import {
  applySystemOpsDentalLabConfig,
  deterministicSystemOpsDentalLabEntityId,
  digestSystemOpsDentalLabConfig,
  digestSystemOpsDentalLabOwnerMembership,
  digestSystemOpsDentalLabSnapshot,
  orderSystemOpsDentalLabPlaybooksForRollback,
  projectSystemOpsDentalLabRuntimeArtifact,
  rollbackSystemOpsDentalLabConfig,
  SYSTEMOPS_DENTAL_LAB_CONFIG,
  SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA,
  validateSystemOpsDentalLabSnapshot,
  type SystemOpsDentalLabConfigSnapshot,
  type SystemOpsDentalLabConfigStore,
  type SystemOpsDentalLabConfigTransaction,
  type SystemOpsDentalLabOrganizationSnapshot,
  type SystemOpsDentalLabPlaybookSnapshot,
  type SystemOpsDentalLabProfessionalSnapshot,
  type SystemOpsDentalLabTreatmentSnapshot,
} from "@/application/labs/systemops-dental-lab-config";
import {
  computeInternalLabRuntimeBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
  protectInternalLabRuntimeArtifactForFile,
  type InternalLabRuntimeArtifact,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import {
  organizations,
  clinicMembers,
  playbookVersions,
  priceCampaigns,
  professionals,
  treatments,
} from "@/infrastructure/db/schema";
import * as schema from "@/infrastructure/db/schema";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type SystemOpsDentalLabCommand = Readonly<{
  mode: "dry-run" | "apply" | "verify" | "rollback";
  clinicId: string;
  expectedChannelDigest: string;
  expectedOwnerMembershipDigest: string;
  snapshotPath: string | null;
  resolvedArtifactPath: string | null;
}>;

type CommandDependencies = Readonly<{
  inspect(clinicId: string): Promise<SystemOpsDentalLabConfigSnapshot | null>;
  apply(input: {
    clinicId: string;
    expectedChannelDigest: string;
    expectedOwnerMembershipDigest: string;
    expectedSnapshotDigest: string;
  }): Promise<SystemOpsDentalLabConfigSnapshot>;
  rollback(input: {
    clinicId: string;
    expectedChannelDigest: string;
    expectedOwnerMembershipDigest: string;
    snapshot: SystemOpsDentalLabConfigSnapshot;
  }): Promise<SystemOpsDentalLabConfigSnapshot>;
  writeOwnerOnlyFile(path: string, contents: string): Promise<void>;
  readOwnerOnlyFile(path: string): Promise<string>;
  resolveRuntimeArtifact(clinicId: string): Promise<InternalLabRuntimeArtifact>;
  write(line: string): void;
}>;

function flagValue(argv: readonly string[], flag: string): string | null {
  const indexes = argv.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} must be provided once`);
  if (indexes.length === 0) return null;
  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseSystemOpsDentalLabCommandArgs(
  argv: readonly string[],
): SystemOpsDentalLabCommand {
  const clinicId = flagValue(argv, "--clinic-id");
  const expectedChannelDigest = flagValue(argv, "--expected-channel-digest");
  const expectedOwnerMembershipDigest = flagValue(argv, "--expected-owner-membership-digest");
  const snapshotPath = flagValue(argv, "--snapshot-file");
  const resolvedArtifactPath = flagValue(argv, "--resolved-artifact-file");
  const rollbackPath = flagValue(argv, "--rollback-snapshot");
  const booleanModes = ["--dry-run", "--apply", "--verify"].filter((flag) => argv.includes(flag));
  const modes = [...booleanModes, ...(rollbackPath ? ["--rollback-snapshot"] : [])];
  if (modes.length !== 1) throw new Error("exactly one mode is required");
  if (!clinicId || !uuidPattern.test(clinicId)) throw new Error("--clinic-id must be an exact UUID");
  if (!expectedChannelDigest || !digestPattern.test(expectedChannelDigest)) {
    throw new Error("--expected-channel-digest must be a sha256 digest");
  }
  if (!expectedOwnerMembershipDigest || !digestPattern.test(expectedOwnerMembershipDigest)) {
    throw new Error("--expected-owner-membership-digest must be a sha256 digest");
  }
  if (modes[0] === "--apply" && !snapshotPath) {
    throw new Error("--snapshot-file is required for apply");
  }

  const valueFlags = new Set([
    "--clinic-id", "--expected-channel-digest", "--expected-owner-membership-digest", "--snapshot-file",
    "--resolved-artifact-file", "--rollback-snapshot",
  ]);
  const booleanFlags = new Set(["--dry-run", "--apply", "--verify"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) continue;
    if (!valueFlags.has(flag)) throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }

  const mode = modes[0] === "--dry-run"
    ? "dry-run"
    : modes[0] === "--apply"
      ? "apply"
      : modes[0] === "--verify"
        ? "verify"
        : "rollback";
  return Object.freeze({
    mode,
    clinicId,
    expectedChannelDigest,
    expectedOwnerMembershipDigest,
    snapshotPath: mode === "rollback" ? rollbackPath : snapshotPath,
    resolvedArtifactPath,
  });
}

function assertTarget(
  snapshot: SystemOpsDentalLabConfigSnapshot | null,
  command: SystemOpsDentalLabCommand,
): asserts snapshot is SystemOpsDentalLabConfigSnapshot {
  if (!snapshot || snapshot.clinicId !== command.clinicId || snapshot.organization.id !== command.clinicId) {
    throw new Error("SystemOps Dental Lab exact target was not found");
  }
  if (
    !snapshot.organization.isTest
    || snapshot.organization.isDemo
    || snapshot.organization.operationalStatus !== "test"
  ) throw new Error("SystemOps Dental Lab target predicates rejected");
  if (snapshot.channelDigest !== command.expectedChannelDigest) {
    throw new Error("SystemOps Dental Lab channel digest mismatch");
  }
  if (
    !snapshot.hasOwnerMembership
    || snapshot.ownerMembershipDigest !== command.expectedOwnerMembershipDigest
  ) throw new Error("SystemOps Dental Lab owner membership digest mismatch");
  if (snapshot.hasActivePriceCampaigns) {
    throw new Error("SystemOps Dental Lab active price campaigns are not allowed");
  }
}

function snapshotArtifact(snapshot: SystemOpsDentalLabConfigSnapshot): string {
  return `${JSON.stringify({
    schemaVersion: SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA,
    desiredConfigDigest: digestSystemOpsDentalLabConfig(),
    snapshotDigest: digestSystemOpsDentalLabSnapshot(snapshot),
    snapshot,
  }, null, 2)}\n`;
}

function parseSnapshotArtifact(value: string): SystemOpsDentalLabConfigSnapshot {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("SystemOps Dental Lab rollback snapshot is invalid JSON");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("SystemOps Dental Lab rollback snapshot is invalid");
  }
  const record = decoded as Record<string, unknown>;
  if (
    record.schemaVersion !== SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA
    || record.desiredConfigDigest !== digestSystemOpsDentalLabConfig()
  ) throw new Error("SystemOps Dental Lab rollback snapshot schema or config mismatch");
  const snapshot = record.snapshot as SystemOpsDentalLabConfigSnapshot;
  if (!snapshot || snapshot.schemaVersion !== SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA) {
    throw new Error("SystemOps Dental Lab rollback snapshot payload is invalid");
  }
  if (record.snapshotDigest !== digestSystemOpsDentalLabSnapshot(snapshot)) {
    throw new Error("SystemOps Dental Lab rollback snapshot digest mismatch");
  }
  return snapshot;
}

export async function runSystemOpsDentalLabConfigCommand(
  command: SystemOpsDentalLabCommand,
  deps: CommandDependencies,
): Promise<Readonly<{
  mode: SystemOpsDentalLabCommand["mode"];
  configDigest: string;
  errors: readonly string[];
}>> {
  const inspected = await deps.inspect(command.clinicId);
  assertTarget(inspected, command);
  const desiredConfigDigest = digestSystemOpsDentalLabConfig();
  let finalSnapshot = inspected;

  if (command.mode === "apply") {
    if (!command.snapshotPath) throw new Error("apply snapshot path is missing");
    await deps.writeOwnerOnlyFile(command.snapshotPath, snapshotArtifact(inspected));
    finalSnapshot = await deps.apply({
      clinicId: command.clinicId,
      expectedChannelDigest: command.expectedChannelDigest,
      expectedOwnerMembershipDigest: command.expectedOwnerMembershipDigest,
      expectedSnapshotDigest: digestSystemOpsDentalLabSnapshot(inspected),
    });
  } else if (command.mode === "rollback") {
    if (!command.snapshotPath) throw new Error("rollback snapshot path is missing");
    const snapshot = parseSnapshotArtifact(await deps.readOwnerOnlyFile(command.snapshotPath));
    assertTarget(snapshot, command);
    finalSnapshot = await deps.rollback({
      clinicId: command.clinicId,
      expectedChannelDigest: command.expectedChannelDigest,
      expectedOwnerMembershipDigest: command.expectedOwnerMembershipDigest,
      snapshot,
    });
  }

  const errors = validateSystemOpsDentalLabSnapshot(finalSnapshot);
  if ((command.mode === "apply" || command.mode === "verify") && errors.length > 0) {
    throw new Error(`SystemOps Dental Lab verification failed: ${errors.join(",")}`);
  }

  deps.write(JSON.stringify({
    mode: command.mode,
    clinicId: command.clinicId,
    desiredConfigDigest,
    channelDigest: command.expectedChannelDigest,
    configured: errors.length === 0,
    reasonCodes: errors,
    mutated: command.mode === "apply" || command.mode === "rollback",
  }));

  if (command.resolvedArtifactPath) {
    const currentArtifact = await deps.resolveRuntimeArtifact(command.clinicId);
    const artifact = command.mode === "dry-run"
      ? projectSystemOpsDentalLabRuntimeArtifact({
          current: currentArtifact,
          snapshot: inspected,
        })
      : currentArtifact;
    const protectedArtifact = protectInternalLabRuntimeArtifactForFile(artifact);
    const bindings = computeInternalLabRuntimeBindings(protectedArtifact);
    await deps.writeOwnerOnlyFile(
      command.resolvedArtifactPath,
      `${JSON.stringify(protectedArtifact, null, 2)}\n`,
    );
    deps.write(JSON.stringify({
      resolvedArtifact: "written_owner_only_outside_worktree",
      bindings,
    }));
  }

  return Object.freeze({ mode: command.mode, configDigest: desiredConfigDigest, errors });
}

type LabDatabase = ReturnType<typeof drizzle<typeof import("@/infrastructure/db/schema")>>;

function channelDigestForOrganization(row: typeof organizations.$inferSelect): string {
  return computeInternalLabRuntimeBindings({
    schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
    clinic: row as unknown as Record<string, unknown>,
    editorial: null,
    modules: [],
    treatments: [],
  }).channelDigest;
}

class DrizzleSystemOpsDentalLabConfigTransaction
implements SystemOpsDentalLabConfigTransaction {
  constructor(private readonly database: LabDatabase) {}

  async readSnapshotForUpdate(clinicId: string) {
    await this.database.execute(drizzleSql`
      select id from organizations where id = ${clinicId}::uuid for update
    `);
    return readDatabaseSnapshot(this.database, clinicId);
  }

  writeOrganization(
    clinicId: string,
    organization: Omit<SystemOpsDentalLabOrganizationSnapshot, "id" | "autoReplyEnabled" | "shadowModeEnabled" | "updatedAt">,
  ): Promise<void> {
    return this.database
      .update(organizations)
      .set({
        ...organization,
        businessSchedule:
          organization.businessSchedule as typeof organizations.$inferInsert.businessSchedule,
        operationalStatus:
          organization.operationalStatus as typeof organizations.$inferInsert.operationalStatus,
        calendarMode:
          organization.calendarMode as typeof organizations.$inferInsert.calendarMode,
        updatedAt: new Date(),
      })
      .where(and(
        eq(organizations.id, clinicId),
        eq(organizations.isTest, true),
        eq(organizations.isDemo, false),
        eq(organizations.operationalStatus, "test"),
      ))
      .returning({ id: organizations.id })
      .then((rows) => {
        if (rows.length !== 1) throw new Error("SystemOps Dental Lab organization update rejected");
      });
  }

  async upsertProfessional(
    clinicId: string,
    professional: Omit<SystemOpsDentalLabProfessionalSnapshot, "id" | "clinicId" | "updatedAt">,
  ): Promise<void> {
    const matches = await this.database
      .select({ id: professionals.id })
      .from(professionals)
      .where(and(eq(professionals.clinicId, clinicId), eq(professionals.name, professional.name)))
      .limit(2);
    if (matches.length > 1) throw new Error("SystemOps Dental Lab professional is ambiguous");
    if (matches[0]) {
      await this.database.update(professionals).set({
        specialty: professional.specialty,
        isActive: professional.isActive,
        googleCalendarId: null,
        workSchedule: null,
        updatedAt: new Date(),
      }).where(and(eq(professionals.id, matches[0].id), eq(professionals.clinicId, clinicId)));
      return;
    }
    await this.database.insert(professionals).values({
      id: deterministicSystemOpsDentalLabEntityId("professional", clinicId, professional.name),
      clinicId,
      name: professional.name,
      specialty: professional.specialty,
      isActive: professional.isActive,
      googleCalendarId: null,
      workSchedule: null,
    });
  }

  async upsertTreatment(
    clinicId: string,
    treatment: Omit<SystemOpsDentalLabTreatmentSnapshot, "id" | "clinicId" | "updatedAt">,
  ): Promise<void> {
    await this.database.insert(treatments).values({
      id: deterministicSystemOpsDentalLabEntityId("treatment", clinicId, treatment.name),
      clinicId,
      ...treatment,
      priceKind: treatment.priceKind as "from" | "fixed",
      description: null,
      aliases: [],
      keywordMatchEnabled: true,
      isAesthetic: treatment.name !== "Avaliação odontológica",
      pipelineSteps: treatment.pipelineSteps,
      pipelineSourceTreatmentId: null,
      pipelineEntryBehavior: treatment.pipelineEntryBehavior as typeof treatments.$inferInsert.pipelineEntryBehavior,
      minPriceCents: null,
      maxPriceCents: null,
      priceUnit: null,
      quantityPrices: null,
      bookingWindows: null,
    }).onConflictDoUpdate({
      target: [treatments.clinicId, treatments.name],
      set: {
        durationMinutes: treatment.durationMinutes,
        description: null,
        requiresEvaluationFirst: treatment.requiresEvaluationFirst,
        keywordMatchEnabled: true,
        aliases: [],
        isAesthetic: treatment.name !== "Avaliação odontológica",
        pipelineSteps: treatment.pipelineSteps,
        pipelineSourceTreatmentId: null,
        pipelineEntryBehavior: treatment.pipelineEntryBehavior as typeof treatments.$inferInsert.pipelineEntryBehavior,
        priceCents: treatment.priceCents,
        minPriceCents: null,
        maxPriceCents: null,
        priceQuotableInChat: treatment.priceQuotableInChat,
        priceKind: treatment.priceKind as "from" | "fixed",
        priceUnit: null,
        priceDeductible: treatment.priceDeductible,
        quantityPrices: null,
        bookingWindows: null,
        updatedAt: new Date(),
      },
    });
  }

  async publishPlaybook(
    clinicId: string,
    playbook: Omit<SystemOpsDentalLabPlaybookSnapshot, "id" | "clinicId" | "updatedAt">,
  ): Promise<void> {
    const matches = await this.database
      .select({ id: playbookVersions.id })
      .from(playbookVersions)
      .where(and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.name, playbook.name)))
      .limit(2);
    if (matches.length > 1) throw new Error("SystemOps Dental Lab playbook is ambiguous");
    await this.database.update(playbookVersions).set({
      status: "historical",
      updatedAt: new Date(),
    }).where(and(
      eq(playbookVersions.clinicId, clinicId),
      eq(playbookVersions.status, "active"),
      ...(matches[0] ? [ne(playbookVersions.id, matches[0].id)] : []),
    ));
    const values = {
      id: matches[0]?.id ?? deterministicSystemOpsDentalLabEntityId(
        "playbook", clinicId, playbook.name,
      ),
      clinicId,
      name: playbook.name,
      status: "active" as const,
      specialty: playbook.specialty,
      toneOfVoice: playbook.toneOfVoice,
      receptionistName: playbook.receptionistName,
      commercialPolicy: playbook.commercialPolicy,
      notes: playbook.notes,
      differentials: [],
      objections: [],
      warrantyPolicy: null,
      mediaAssetIds: [],
      mediaLibrary: [],
    };
    if (matches[0]) {
      await this.database.update(playbookVersions).set({ ...values, updatedAt: new Date() })
        .where(and(eq(playbookVersions.id, matches[0].id), eq(playbookVersions.clinicId, clinicId)));
      return;
    }
    await this.database.insert(playbookVersions).values(values);
  }

  readSnapshot(clinicId: string) {
    return readDatabaseSnapshot(this.database, clinicId).then((snapshot) => {
      if (!snapshot) throw new Error("SystemOps Dental Lab snapshot disappeared");
      return snapshot;
    });
  }

  async restoreSnapshot(snapshot: SystemOpsDentalLabConfigSnapshot): Promise<void> {
    const clinicId = snapshot.clinicId;
    await this.database.update(playbookVersions).set({ status: "historical" }).where(and(
      eq(playbookVersions.clinicId, clinicId),
      eq(playbookVersions.status, "active"),
    ));
    const currentProfessional = await this.database.select({ id: professionals.id })
      .from(professionals)
      .where(and(
        eq(professionals.clinicId, clinicId),
        eq(professionals.name, SYSTEMOPS_DENTAL_LAB_CONFIG.professional.name),
      ));
    const previousProfessional = snapshot.professionals.find((entry) =>
      entry.name === SYSTEMOPS_DENTAL_LAB_CONFIG.professional.name);
    if (!previousProfessional) {
      for (const row of currentProfessional) {
        await this.database.delete(professionals).where(and(
          eq(professionals.id, row.id), eq(professionals.clinicId, clinicId),
        ));
      }
    } else {
      await this.database.update(professionals).set({
        name: previousProfessional.name,
        specialty: previousProfessional.specialty,
        isActive: previousProfessional.isActive,
        color: previousProfessional.color ?? "#10B981",
        workSchedule:
          previousProfessional.workSchedule as typeof professionals.$inferInsert.workSchedule,
        googleCalendarId: previousProfessional.googleCalendarId ?? null,
        updatedAt: new Date(previousProfessional.updatedAt),
      }).where(and(eq(professionals.id, previousProfessional.id), eq(professionals.clinicId, clinicId)));
    }

    for (const desired of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      const previous = snapshot.treatments.find((entry) => entry.name === desired.name);
      if (!previous) {
        await this.database.delete(treatments).where(and(
          eq(treatments.clinicId, clinicId), eq(treatments.name, desired.name),
        ));
      } else {
        await this.database.update(treatments).set({
          name: previous.name,
          priceCents: previous.priceCents,
          priceKind: previous.priceKind as "from" | "fixed",
          priceQuotableInChat: previous.priceQuotableInChat,
          priceDeductible: previous.priceDeductible,
          durationMinutes: previous.durationMinutes,
          requiresEvaluationFirst: previous.requiresEvaluationFirst,
          description: previous.description ?? null,
          keywordMatchEnabled: previous.keywordMatchEnabled ?? true,
          aliases: previous.aliases ?? [],
          isAesthetic: previous.isAesthetic ?? false,
          pipelineSteps: previous.pipelineSteps as typeof treatments.$inferInsert.pipelineSteps,
          pipelineSourceTreatmentId: previous.pipelineSourceTreatmentId ?? null,
          pipelineEntryBehavior:
            previous.pipelineEntryBehavior as typeof treatments.$inferInsert.pipelineEntryBehavior,
          minPriceCents: previous.minPriceCents ?? null,
          maxPriceCents: previous.maxPriceCents ?? null,
          priceUnit: previous.priceUnit ?? null,
          quantityPrices:
            previous.quantityPrices as typeof treatments.$inferInsert.quantityPrices,
          bookingWindows:
            previous.bookingWindows as typeof treatments.$inferInsert.bookingWindows,
          updatedAt: new Date(previous.updatedAt),
        }).where(and(eq(treatments.id, previous.id), eq(treatments.clinicId, clinicId)));
      }
    }

    const currentDesiredPlaybook = await this.database.select({ id: playbookVersions.id })
      .from(playbookVersions)
      .where(and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.name, SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.name),
      ));
    const previousIds = new Set(snapshot.playbooks.map((entry) => entry.id));
    for (const row of currentDesiredPlaybook) {
      if (!previousIds.has(row.id)) {
        await this.database.delete(playbookVersions).where(and(
          eq(playbookVersions.id, row.id), eq(playbookVersions.clinicId, clinicId),
        ));
      }
    }
    for (const previous of orderSystemOpsDentalLabPlaybooksForRollback(snapshot.playbooks)) {
      await this.database.update(playbookVersions).set({
        name: previous.name,
        status: previous.status as "active" | "draft" | "historical",
        specialty: previous.specialty,
        toneOfVoice: previous.toneOfVoice,
        receptionistName: previous.receptionistName,
        commercialPolicy: previous.commercialPolicy,
        notes: previous.notes,
        differentials: previous.differentials ?? [],
        objections:
          previous.objections as typeof playbookVersions.$inferInsert.objections,
        warrantyPolicy:
          previous.warrantyPolicy as typeof playbookVersions.$inferInsert.warrantyPolicy,
        mediaAssetIds: previous.mediaAssetIds ?? [],
        mediaLibrary:
          previous.mediaLibrary as typeof playbookVersions.$inferInsert.mediaLibrary,
        updatedAt: new Date(previous.updatedAt),
      }).where(and(eq(playbookVersions.id, previous.id), eq(playbookVersions.clinicId, clinicId)));
    }

    await this.database.update(organizations).set({
      name: snapshot.organization.name,
      specialty: snapshot.organization.specialty,
      city: snapshot.organization.city,
      address: snapshot.organization.address,
      addressComplement: snapshot.organization.addressComplement,
      locationMessage: snapshot.organization.locationMessage,
      timezone: snapshot.organization.timezone,
      businessHours: snapshot.organization.businessHours,
      businessSchedule: snapshot.organization.businessSchedule as typeof organizations.$inferInsert.businessSchedule,
      operationalStatus: snapshot.organization.operationalStatus as "prospect" | "test" | "active" | "paused" | "cancelled",
      isTest: snapshot.organization.isTest,
      isDemo: snapshot.organization.isDemo,
      calendarMode: snapshot.organization.calendarMode as "internal" | "google_calendar" | null,
      updatedAt: new Date(snapshot.organization.updatedAt),
    }).where(eq(organizations.id, clinicId));
  }
}

async function readDatabaseSnapshot(
  database: LabDatabase,
  clinicId: string,
): Promise<SystemOpsDentalLabConfigSnapshot | null> {
  const [
    organization,
    professionalRows,
    treatmentRows,
    playbookRows,
    ownerMembership,
    activeCampaigns,
  ] = await Promise.all([
    database.select().from(organizations).where(eq(organizations.id, clinicId)).limit(1)
      .then((rows) => rows[0] ?? null),
    database.select({
      id: professionals.id,
      clinicId: professionals.clinicId,
      name: professionals.name,
      specialty: professionals.specialty,
      isActive: professionals.isActive,
      color: professionals.color,
      workSchedule: professionals.workSchedule,
      googleCalendarId: professionals.googleCalendarId,
      updatedAt: professionals.updatedAt,
    }).from(professionals).where(eq(professionals.clinicId, clinicId)),
    database.select({
      id: treatments.id,
      clinicId: treatments.clinicId,
      name: treatments.name,
      priceCents: treatments.priceCents,
      priceKind: treatments.priceKind,
      priceQuotableInChat: treatments.priceQuotableInChat,
      priceDeductible: treatments.priceDeductible,
      durationMinutes: treatments.durationMinutes,
      requiresEvaluationFirst: treatments.requiresEvaluationFirst,
      description: treatments.description,
      keywordMatchEnabled: treatments.keywordMatchEnabled,
      aliases: treatments.aliases,
      isAesthetic: treatments.isAesthetic,
      pipelineSteps: treatments.pipelineSteps,
      pipelineSourceTreatmentId: treatments.pipelineSourceTreatmentId,
      pipelineEntryBehavior: treatments.pipelineEntryBehavior,
      minPriceCents: treatments.minPriceCents,
      maxPriceCents: treatments.maxPriceCents,
      priceUnit: treatments.priceUnit,
      quantityPrices: treatments.quantityPrices,
      bookingWindows: treatments.bookingWindows,
      updatedAt: treatments.updatedAt,
    }).from(treatments).where(eq(treatments.clinicId, clinicId)),
    database.select({
      id: playbookVersions.id,
      clinicId: playbookVersions.clinicId,
      name: playbookVersions.name,
      status: playbookVersions.status,
      specialty: playbookVersions.specialty,
      toneOfVoice: playbookVersions.toneOfVoice,
      receptionistName: playbookVersions.receptionistName,
      commercialPolicy: playbookVersions.commercialPolicy,
      notes: playbookVersions.notes,
      differentials: playbookVersions.differentials,
      objections: playbookVersions.objections,
      warrantyPolicy: playbookVersions.warrantyPolicy,
      mediaAssetIds: playbookVersions.mediaAssetIds,
      mediaLibrary: playbookVersions.mediaLibrary,
      updatedAt: playbookVersions.updatedAt,
    }).from(playbookVersions).where(eq(playbookVersions.clinicId, clinicId)),
    database.select({
      id: clinicMembers.id,
      email: clinicMembers.email,
      role: clinicMembers.role,
    })
      .from(clinicMembers)
      .where(and(eq(clinicMembers.clinicId, clinicId), eq(clinicMembers.role, "owner"))),
    database.select({ id: priceCampaigns.id })
      .from(priceCampaigns)
      .where(and(eq(priceCampaigns.clinicId, clinicId), eq(priceCampaigns.isActive, true)))
      .limit(1),
  ]);
  if (!organization) return null;
  return {
    schemaVersion: SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA,
    clinicId,
    channelDigest: channelDigestForOrganization(organization),
    hasOwnerMembership: ownerMembership.length > 0,
    ownerMembershipDigest: digestSystemOpsDentalLabOwnerMembership(ownerMembership),
    hasActivePriceCampaigns: activeCampaigns.length > 0,
    organization: {
      id: organization.id,
      name: organization.name,
      specialty: organization.specialty,
      city: organization.city,
      address: organization.address,
      addressComplement: organization.addressComplement,
      locationMessage: organization.locationMessage,
      timezone: organization.timezone,
      businessHours: organization.businessHours,
      businessSchedule: organization.businessSchedule,
      operationalStatus: organization.operationalStatus,
      isTest: organization.isTest,
      isDemo: organization.isDemo,
      calendarMode: organization.calendarMode,
      autoReplyEnabled: organization.autoReplyEnabled,
      shadowModeEnabled: organization.shadowModeEnabled,
      updatedAt: organization.updatedAt.toISOString(),
    },
    professionals: professionalRows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    })),
    treatments: treatmentRows.map((row) => ({
      ...row,
      pipelineSteps: row.pipelineSteps as import("@/domain/entities/treatment").PipelineStep[] | null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    playbooks: playbookRows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

class DrizzleSystemOpsDentalLabConfigStore implements SystemOpsDentalLabConfigStore {
  private readonly database: LabDatabase;

  constructor(private readonly client: ReturnType<typeof postgres>) {
    this.database = drizzle(client, { schema });
  }

  readSnapshot(clinicId: string) {
    return readDatabaseSnapshot(this.database, clinicId);
  }

  transaction<T>(
    _clinicId: string,
    operation: (transaction: SystemOpsDentalLabConfigTransaction) => Promise<T>,
  ): Promise<T> {
    return this.client.begin(async (transactionClient) => operation(
      new DrizzleSystemOpsDentalLabConfigTransaction(drizzle(
        transactionClient as unknown as ReturnType<typeof postgres>,
        { schema },
      )),
    )) as Promise<T>;
  }
}

function assertOutsideWorktree(path: string, flag: string): void {
  const relativePath = relative(repositoryRoot, path);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) {
    throw new Error(`${flag} must be outside the repository worktree`);
  }
}

async function resolveProtectedOutputPath(value: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error("artifact path must be absolute");
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, "artifact path");
  const parent = await realpath(dirname(lexicalPath));
  const output = resolve(parent, basename(lexicalPath));
  assertOutsideWorktree(output, "artifact path");
  return output;
}

async function writeOwnerOnlyFile(path: string, contents: string): Promise<void> {
  const output = await resolveProtectedOutputPath(path);
  await writeFile(output, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function readOwnerOnlyFile(value: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error("snapshot path must be absolute");
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, "snapshot path");
  const path = await realpath(lexicalPath);
  assertOutsideWorktree(path, "snapshot path");
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await descriptor.stat({ bigint: true });
    const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
    if (!before.isFile() || (before.mode & 0o077n) !== 0n || (currentUid !== null && before.uid !== currentUid)) {
      throw new Error("snapshot path must be an owner-controlled file");
    }
    if (before.nlink !== 1n) throw new Error("snapshot path must have a single link");
    const contents = await descriptor.readFile({ encoding: "utf8" });
    const [after, pathAfter] = await Promise.all([
      descriptor.stat({ bigint: true }),
      stat(path, { bigint: true }),
    ]);
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || after.dev !== pathAfter.dev || after.ino !== pathAfter.ino
    ) throw new Error("snapshot path changed while being read");
    return contents;
  } finally {
    await descriptor.close();
  }
}

async function resolveRuntimeArtifact(clinicId: string): Promise<InternalLabRuntimeArtifact> {
  const context = new DrizzleLiveConversationContextReader();
  const clinic = await context.findOrganization(clinicId);
  if (!clinic) throw new Error("SystemOps Dental Lab runtime artifact target unavailable");
  const treatmentRepository = new DrizzleTreatmentRepository();
  const [editorial, modules, clinicTreatments] = await Promise.all([
    context.resolveEditorialConfig(clinicId),
    getClinicModules(clinicId),
    treatmentRepository.listByClinic(clinicId),
  ]);
  return Object.freeze({
    schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
    clinic: context.getOrganizationRow(clinic) as unknown as Record<string, unknown>,
    editorial,
    modules,
    treatments: clinicTreatments.map((treatment) =>
      treatment as unknown as Record<string, unknown>),
  });
}

async function main(): Promise<void> {
  const command = parseSystemOpsDentalLabCommandArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 1 });
  const store = new DrizzleSystemOpsDentalLabConfigStore(client);
  try {
    await runSystemOpsDentalLabConfigCommand(command, {
      inspect: (clinicId) => store.readSnapshot(clinicId),
      apply: ({
        clinicId,
        expectedChannelDigest,
        expectedOwnerMembershipDigest,
        expectedSnapshotDigest,
      }) =>
        applySystemOpsDentalLabConfig(store, {
          clinicId,
          expectedChannelDigest,
          expectedOwnerMembershipDigest,
          expectedSnapshotDigest,
        }),
      rollback: ({ clinicId, expectedChannelDigest, expectedOwnerMembershipDigest, snapshot }) =>
        rollbackSystemOpsDentalLabConfig(store, {
          clinicId, expectedChannelDigest, expectedOwnerMembershipDigest,
        }, snapshot),
      writeOwnerOnlyFile,
      readOwnerOnlyFile,
      resolveRuntimeArtifact,
      write: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write("reasonCodes=command_failed\n");
    process.exitCode = 1;
  });
}
