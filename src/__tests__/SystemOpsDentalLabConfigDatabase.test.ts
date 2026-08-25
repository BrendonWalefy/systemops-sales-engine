import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { and, eq, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  SYSTEMOPS_DENTAL_LAB_CONFIG,
  digestSystemOpsDentalLabConfig,
  digestSystemOpsDentalLabOwnerMembership,
} from "@/application/labs/systemops-dental-lab-config";
import {
  computeInternalLabRuntimeBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  clinicMembers,
  organizations,
  playbookVersions,
  professionals,
  treatments,
} from "@/infrastructure/db/schema";
import {
  cleanupEmbeddedAuthorityDatabase,
  startEmbeddedAuthorityDatabase,
  type EmbeddedAuthorityDatabase,
} from "./helpers/embedded-authority-database";

const executeFile = promisify(execFile);
const resolveModule = createRequire(import.meta.url);
const TSX_CLI_PATH = resolveModule.resolve("tsx/cli");
const LAB_ID = "00000000-0000-4000-8000-000000000101";
const OWNER_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_ID = "00000000-0000-4000-8000-000000000103";
const OWNER_EMAIL = "owner@systemops-lab.invalid";

describe("SystemOps Dental Lab config — PostgreSQL adapter", () => {
  let runtime: EmbeddedAuthorityDatabase | undefined;
  let database: ReturnType<typeof drizzleNodePostgres>;
  let connectionString = "";
  let channelDigest = "";
  let ownerMembershipDigest = "";

  function commandEnvironment(): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: connectionString,
      NODE_ENV: "test",
      PATH: process.env.PATH,
    };
  }

  function executeConfigCli(arguments_: readonly string[]) {
    return executeFile(process.execPath, [
      TSX_CLI_PATH,
      "scripts/configure-systemops-dental-lab.ts",
      ...arguments_,
    ], {
      cwd: process.cwd(),
      env: commandEnvironment(),
    });
  }

  async function managedStateDigest(): Promise<string> {
    const [organizationRows, professionalRows, treatmentRows, playbookRows] = await Promise.all([
      database.select().from(organizations).where(eq(organizations.id, LAB_ID)),
      database.select().from(professionals).where(eq(professionals.clinicId, LAB_ID)),
      database.select().from(treatments).where(eq(treatments.clinicId, LAB_ID)),
      database.select().from(playbookVersions).where(eq(playbookVersions.clinicId, LAB_ID)),
    ]);
    const ordered = {
      organizations: organizationRows.sort((left, right) => left.id.localeCompare(right.id)),
      professionals: professionalRows.sort((left, right) => left.id.localeCompare(right.id)),
      treatments: treatmentRows.sort((left, right) => left.id.localeCompare(right.id)),
      playbooks: playbookRows.sort((left, right) => left.id.localeCompare(right.id)),
    };
    return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  }

  beforeAll(async () => {
    runtime = await startEmbeddedAuthorityDatabase();
    database = drizzleNodePostgres(runtime.pool);
    await migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });

    await database.insert(organizations).values({
      id: LAB_ID,
      slug: "systemops-lab-config-test",
      name: SYSTEMOPS_DENTAL_LAB_CONFIG.name,
      specialty: SYSTEMOPS_DENTAL_LAB_CONFIG.specialty,
      city: SYSTEMOPS_DENTAL_LAB_CONFIG.city,
      address: SYSTEMOPS_DENTAL_LAB_CONFIG.address,
      addressComplement: SYSTEMOPS_DENTAL_LAB_CONFIG.addressComplement,
      locationMessage: SYSTEMOPS_DENTAL_LAB_CONFIG.locationMessage,
      timezone: SYSTEMOPS_DENTAL_LAB_CONFIG.timezone,
      businessHours: SYSTEMOPS_DENTAL_LAB_CONFIG.businessHours,
      businessSchedule: structuredClone(
        SYSTEMOPS_DENTAL_LAB_CONFIG.businessSchedule,
      ) as unknown as typeof organizations.$inferInsert.businessSchedule,
      operationalStatus: "test",
      isTest: true,
      isDemo: false,
      calendarMode: "internal",
      autoReplyEnabled: true,
    });
    await database.insert(organizations).values({
      id: OTHER_ID,
      slug: "unrelated-config-test",
      name: "Unrelated test tenant",
      specialty: "dental",
      operationalStatus: "test",
      isTest: true,
      isDemo: false,
    });
    await database.insert(clinicMembers).values({
      id: OWNER_ID,
      clinicId: LAB_ID,
      email: OWNER_EMAIL,
      role: "owner",
    });
    await database.insert(professionals).values({
      clinicId: LAB_ID,
      ...SYSTEMOPS_DENTAL_LAB_CONFIG.professional,
    });
    await database.insert(treatments).values(SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.map(
      (treatment, index): typeof treatments.$inferInsert => ({
        clinicId: LAB_ID,
        ...treatment,
        description: `legacy-description-${index}`,
        aliases: [`legacy-alias-${index}`],
        pipelineSteps: (index === 1
          ? treatment.pipelineSteps.slice(1).map((step) => ({ ...step }))
          : treatment.pipelineSteps.map((step) => ({ ...step }))) as
            typeof treatments.$inferInsert.pipelineSteps,
      }),
    ));
    await database.insert(treatments).values({
      clinicId: OTHER_ID,
      ...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0],
      aliases: [...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0].aliases],
      pipelineSteps: SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0].pipelineSteps
        .map((step) => ({ ...step })) as typeof treatments.$inferInsert.pipelineSteps,
    });
    await database.insert(playbookVersions).values({
      clinicId: LAB_ID,
      ...SYSTEMOPS_DENTAL_LAB_CONFIG.playbook,
    });

    const [organization] = await database.select().from(organizations)
      .where(eq(organizations.id, LAB_ID));
    channelDigest = computeInternalLabRuntimeBindings({
      schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
      clinic: organization as unknown as Record<string, unknown>,
      editorial: null,
      modules: [],
      treatments: [],
    }).channelDigest;
    ownerMembershipDigest = digestSystemOpsDentalLabOwnerMembership([{
      id: OWNER_ID,
      email: OWNER_EMAIL,
      role: "owner",
    }]);

    const options = runtime.pool.options;
    connectionString = `postgresql://${encodeURIComponent(String(options.user))}:${encodeURIComponent(String(options.password))}@127.0.0.1:${String(options.port)}/${encodeURIComponent(String(options.database))}`;
  });

  beforeEach(async () => {
    for (const [index, treatment] of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.entries()) {
      await database.update(treatments).set({
        description: `legacy-description-${index}`,
        aliases: [`legacy-alias-${index}`],
        pipelineSteps: (index === 1
          ? treatment.pipelineSteps.slice(1).map((step) => ({ ...step }))
          : treatment.pipelineSteps.map((step) => ({ ...step }))) as
            typeof treatments.$inferInsert.pipelineSteps,
      }).where(and(
        eq(treatments.clinicId, LAB_ID),
        eq(treatments.name, treatment.name),
      ));
    }
  });

  afterAll(async () => {
    await cleanupEmbeddedAuthorityDatabase(runtime ?? {});
  });

  it("atomically applies description, alias and pipeline drift through the canonical CLI", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "systemops-lab-config-apply-"));
    const snapshotPath = join(outputDirectory, "snapshot.json");
    const unrelatedBefore = await database.select().from(treatments)
      .where(eq(treatments.clinicId, OTHER_ID));
    try {
      const result = await executeConfigCli([
        "--clinic-id", LAB_ID,
        "--expected-channel-digest", channelDigest,
        "--expected-owner-membership-digest", ownerMembershipDigest,
        "--apply",
        "--snapshot-file", snapshotPath,
      ]);

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain('"configured":true');
      const output = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(output[0]).toMatchObject({
        desiredConfigDigest: digestSystemOpsDentalLabConfig(),
        configured: true,
      });
      const persisted = await database.select().from(treatments)
        .where(eq(treatments.clinicId, LAB_ID));
      for (const treatment of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
        const row = persisted.find((candidate) => candidate.name === treatment.name);
        expect(row?.description).toBe(treatment.description);
        expect(row?.aliases).toEqual([...treatment.aliases]);
        expect(row?.pipelineSteps).toEqual([...treatment.pipelineSteps]);
      }
      expect(await database.select().from(treatments)
        .where(eq(treatments.clinicId, OTHER_ID))).toEqual(unrelatedBefore);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("keeps dry-run read-only while reporting the reviewed drift", async () => {
    const before = await database.select().from(treatments)
      .where(eq(treatments.clinicId, LAB_ID));

    const result = await executeConfigCli([
      "--clinic-id", LAB_ID,
      "--expected-channel-digest", channelDigest,
      "--expected-owner-membership-digest", ownerMembershipDigest,
      "--dry-run",
    ]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"configured":false');
    expect(await database.select().from(treatments)
      .where(eq(treatments.clinicId, LAB_ID))).toEqual(before);
  });

  it("enforces treatment identity per tenant without leaking alias convergence", async () => {
    const declaredAliases = SYSTEMOPS_DENTAL_LAB_CONFIG.treatments
      .flatMap((treatment) => treatment.aliases);
    expect(new Set(declaredAliases).size).toBe(declaredAliases.length);

    let duplicate: Readonly<{ code?: string; constraint?: string }> = {};
    try {
      await database.insert(treatments).values({
        clinicId: LAB_ID,
        ...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0],
        aliases: [...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0].aliases],
        pipelineSteps: SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0].pipelineSteps
          .map((step) => ({ ...step })) as typeof treatments.$inferInsert.pipelineSteps,
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
      duplicate = { code: cause?.code, constraint: cause?.constraint };
    }
    expect(duplicate).toEqual({
      code: "23505",
      constraint: "treatments_org_name_idx",
    });
    expect(await database.select().from(treatments)
      .where(and(
        eq(treatments.clinicId, OTHER_ID),
        eq(treatments.name, SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[0].name),
      ))).toHaveLength(1);
  });

  it("rolls back an invalid treatment and emits only a sanitized failing stage", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "systemops-lab-config-failure-"));
    const snapshotPath = join(outputDirectory, "snapshot.json");
    const resolvedArtifactPath = join(outputDirectory, "resolved.json");
    const beforeDigest = await managedStateDigest();
    await database.execute(sql`
      alter table treatments
      add constraint test_reject_configured_treatment
      check (duration_minutes <> 180 or description is null) not valid
    `);
    try {
      let failure: unknown;
      try {
        await executeConfigCli([
          "--clinic-id", LAB_ID,
          "--expected-channel-digest", channelDigest,
          "--expected-owner-membership-digest", ownerMembershipDigest,
          "--apply",
          "--snapshot-file", snapshotPath,
          "--resolved-artifact-file", resolvedArtifactPath,
        ]);
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        code: 1,
        stdout: "",
        stderr: "stage=treatment_convergence reasonCodes=command_failed errorClass=Error\n",
      });
      await expect(access(snapshotPath)).resolves.toBeUndefined();
      await expect(access(resolvedArtifactPath)).rejects.toThrow();
      expect(await managedStateDigest()).toBe(beforeDigest);
    } finally {
      await database.execute(sql`
        alter table treatments drop constraint if exists test_reject_configured_treatment
      `);
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
