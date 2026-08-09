import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";

import {
  SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
} from "@/application/labs/systemops-lab-channel-transfer";
import { encryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import { DrizzleSystemOpsLabChannelTransferRepository } from "@/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository";
import { runSystemOpsLabTransferCommand } from "../../scripts/transfer-systemops-lab-channel";

const safeEnv = {
  SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
  SYSTEMOPS_LAB_ZAPI_INSTANCE_ID: "instance-1",
  SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID: "old-id",
};

async function reserveAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve a local PostgreSQL test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

describe("SystemOps Lab transfer command", () => {
  it("is dry-run by default and never transfers", async () => {
    const transfer = vi.fn();
    const lines: string[] = [];
    const result = await runSystemOpsLabTransferCommand(safeEnv, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer,
      write: (line) => lines.push(line),
    });

    expect(result).toEqual({ mode: "dry-run", applied: false });
    expect(transfer).not.toHaveBeenCalled();
    expect(lines).toContain("expectedSourceClinicId=old-id");
    expect(lines).toContain("sourceClinicId=old-id");
    expect(lines.join("\n")).not.toContain("rotated-token");
  });

  it("requires both apply and the exact confirmation", async () => {
    const transfer = vi.fn();

    await expect(runSystemOpsLabTransferCommand({
      ...safeEnv,
      SYSTEMOPS_LAB_ZAPI_TOKEN: "rotated-token",
      SYSTEMOPS_LAB_APPLY: "true",
    }, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer,
      write: vi.fn(),
    })).rejects.toThrow("SYSTEMOPS_LAB_TRANSFER_CONFIRMATION");

    expect(transfer).not.toHaveBeenCalled();
  });

  it("applies once with exact confirmation without printing credentials", async () => {
    const transfer = vi.fn().mockResolvedValue(undefined);
    const lines: string[] = [];

    const result = await runSystemOpsLabTransferCommand({
      ...safeEnv,
      SYSTEMOPS_LAB_ZAPI_TOKEN: "rotated-token",
      SYSTEMOPS_LAB_ZAPI_CLIENT_TOKEN: "private-client-token",
      SYSTEMOPS_LAB_APPLY: "true",
      SYSTEMOPS_LAB_TRANSFER_CONFIRMATION: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    }, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer,
      write: (line) => lines.push(line),
    });

    expect(result).toEqual({ mode: "apply", applied: true });
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledWith({
      targetClinicId: "lab-id",
      instanceId: "instance-1",
      rotatedToken: "rotated-token",
      clientToken: "private-client-token",
      expectedSourceClinicId: "old-id",
      confirmation: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    });
    expect(lines.join("\n")).not.toContain("rotated-token");
    expect(lines.join("\n")).not.toContain("private-client-token");
  });

  it("redacts credentials from transfer failures", async () => {
    const lines: string[] = [];

    const operation = runSystemOpsLabTransferCommand({
      ...safeEnv,
      SYSTEMOPS_LAB_ZAPI_TOKEN: "rotated-token",
      SYSTEMOPS_LAB_ZAPI_CLIENT_TOKEN: "private-client-token",
      SYSTEMOPS_LAB_APPLY: "true",
      SYSTEMOPS_LAB_TRANSFER_CONFIRMATION: SYSTEMOPS_LAB_TRANSFER_CONFIRMATION,
    }, {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer: vi.fn().mockRejectedValue(
        new Error("provider exposed rotated-token and private-client-token"),
      ),
      write: (line) => lines.push(line),
    });

    await expect(operation).rejects.toThrow("SystemOps Lab transfer apply failed");
    await expect(operation).rejects.not.toThrow("rotated-token");
    await expect(operation).rejects.not.toThrow("private-client-token");
    expect(lines.join("\n")).not.toContain("rotated-token");
    expect(lines.join("\n")).not.toContain("private-client-token");
  });

  it("fails closed on an unsafe inspection and prints reason codes without credentials", async () => {
    const transfer = vi.fn();
    const lines: string[] = [];

    await expect(runSystemOpsLabTransferCommand({
      ...safeEnv,
      SYSTEMOPS_LAB_ZAPI_TOKEN: "rotated-token",
    }, {
      inspect: vi.fn().mockResolvedValue({
        safe: false,
        sourceClinicId: "old-id",
        reasons: ["target_automation_enabled"],
      }),
      transfer,
      write: (line) => lines.push(line),
    })).rejects.toThrow("inspection rejected");

    expect(transfer).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("target_automation_enabled");
    expect(lines.join("\n")).not.toContain("rotated-token");
  });

  it("does not print unrecognized inspection reasons", async () => {
    const lines: string[] = [];

    await expect(runSystemOpsLabTransferCommand(safeEnv, {
      inspect: vi.fn().mockResolvedValue({
        safe: false,
        sourceClinicId: "old-id",
        reasons: ["credential-shaped-reason"],
      }),
      transfer: vi.fn(),
      write: (line) => lines.push(line),
    })).rejects.toThrow("inspection rejected");

    expect(lines.join("\n")).toContain("unrecognized_reason_code");
    expect(lines.join("\n")).not.toContain("credential-shaped-reason");
  });

  it("redacts inspection failures before they escape the command", async () => {
    const operation = runSystemOpsLabTransferCommand(safeEnv, {
      inspect: vi.fn().mockRejectedValue(
        new Error("inspection exposed current-token"),
      ),
      transfer: vi.fn(),
      write: vi.fn(),
    });

    await expect(operation).rejects.toThrow("SystemOps Lab transfer inspection failed");
    await expect(operation).rejects.not.toThrow("current-token");
  });

  it("requires the expected source only when inspection finds an owner", async () => {
    const deps = {
      inspect: vi.fn().mockResolvedValue({ safe: true, sourceClinicId: "old-id" }),
      transfer: vi.fn(),
      write: vi.fn(),
    };

    await expect(runSystemOpsLabTransferCommand({
      SYSTEMOPS_LAB_CLINIC_ID: "lab-id",
      SYSTEMOPS_LAB_ZAPI_INSTANCE_ID: "instance-1",
    }, deps)).rejects.toThrow("SYSTEMOPS_LAB_EXPECTED_SOURCE_CLINIC_ID");

    expect(deps.transfer).not.toHaveBeenCalled();
  });
});

describe("Drizzle SystemOps Lab channel transfer repository", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads target and owner while decrypting the current credential only in memory", async () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "00".repeat(32));
    const encryptedCurrentToken = encryptCredentialNullable("current-token");
    const execute = vi.fn().mockResolvedValue({
      rows: [{
        target_id: "00000000-0000-4000-8000-000000000001",
        target_name: "SystemOps Lab",
        target_is_test: true,
        target_is_demo: false,
        target_operational_status: "test",
        target_auto_reply_enabled: false,
        target_shadow_mode_enabled: false,
        target_zapi_instance_id: null,
        source_id: "00000000-0000-4000-8000-000000000002",
        source_name: "Previous owner",
        source_zapi_instance_id: "instance-1",
        source_zapi_token: encryptedCurrentToken,
      }],
    });
    const repository = new DrizzleSystemOpsLabChannelTransferRepository({ execute });

    const context = await repository.readContext(
      "instance-1",
      "00000000-0000-4000-8000-000000000001",
    );

    expect(context).toEqual({
      target: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "SystemOps Lab",
        isTest: true,
        isDemo: false,
        operationalStatus: "test",
        autoReplyEnabled: false,
        shadowModeEnabled: false,
        zapiInstanceId: null,
      },
      source: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Previous owner",
        zapiInstanceId: "instance-1",
        currentPlaintextToken: "current-token",
      },
    });
  });

  it("emits one guarded atomic statement with encrypted rotated credentials", async () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "11".repeat(32));
    const execute = vi.fn().mockResolvedValue({
      rows: [{ id: "00000000-0000-4000-8000-000000000001" }],
    });
    const repository = new DrizzleSystemOpsLabChannelTransferRepository({ execute });

    await repository.transfer({
      targetClinicId: "00000000-0000-4000-8000-000000000001",
      instanceId: "instance-1",
      rotatedToken: "rotated-token",
      clientToken: "private-client-token",
      expectedSourceClinicId: "  00000000-0000-4000-8000-000000000002  ",
    });

    expect(execute).toHaveBeenCalledOnce();
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(statement.sql).toContain("with eligible_target as");
    expect(statement.sql).toContain("is_test = true");
    expect(statement.sql).toContain("is_demo = false");
    expect(statement.sql).toContain("operational_status = 'test'");
    expect(statement.sql).toContain("auto_reply_enabled = false");
    expect(statement.sql).toContain("shadow_mode_enabled = false");
    expect(statement.sql).toContain("for update");
    expect(statement.sql).toContain("detached as");
    expect(statement.sql).toContain("returning id");
    const outerUpdate = statement.sql.slice(statement.sql.lastIndexOf("update organizations"));
    expect(outerUpdate).toContain("from detached");
    expect(outerUpdate).toMatch(
      /exists \(\s*select 1\s*from detached\s*where detached\.id = \$\d+::uuid\s*\)/,
    );
    expect(statement.params).toContain("00000000-0000-4000-8000-000000000002");
    expect(statement.params).not.toContain("  00000000-0000-4000-8000-000000000002  ");
    expect(statement.params).not.toContain("rotated-token");
    expect(statement.params).not.toContain("private-client-token");
    expect(statement.params.filter(
      (value) => typeof value === "string" && value.startsWith("enc:v1:"),
    )).toHaveLength(2);
  });

  it("rejects when the database guard returns no target", async () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "22".repeat(32));
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new DrizzleSystemOpsLabChannelTransferRepository({ execute });

    await expect(repository.transfer({
      targetClinicId: "00000000-0000-4000-8000-000000000001",
      instanceId: "instance-1",
      rotatedToken: "rotated-token",
      clientToken: null,
      expectedSourceClinicId: null,
    })).rejects.toThrow("Atomic Lab transfer rejected by database guard");
  });

  it("sanitizes database errors that could include encrypted parameters", async () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "33".repeat(32));
    const execute = vi.fn().mockRejectedValue(
      new Error("driver included enc:v1:sensitive-parameter"),
    );
    const repository = new DrizzleSystemOpsLabChannelTransferRepository({ execute });

    const operation = repository.transfer({
      targetClinicId: "00000000-0000-4000-8000-000000000001",
      instanceId: "instance-1",
      rotatedToken: "rotated-token",
      clientToken: null,
      expectedSourceClinicId: null,
    });

    await expect(operation).rejects.toThrow("Atomic Lab transfer failed");
    await expect(operation).rejects.not.toThrow("enc:v1:sensitive-parameter");
  });

  it("resolves the current owner id without exposing channel credentials", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ id: "00000000-0000-4000-8000-000000000001" }],
    });
    const repository = new DrizzleSystemOpsLabChannelTransferRepository({ execute });

    await expect(repository.resolveClinicIdByInstance("instance-1"))
      .resolves.toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe.sequential("SystemOps Lab atomic transfer on isolated PostgreSQL", () => {
  const sourceId = "10000000-0000-4000-8000-000000000001";
  const targetAId = "20000000-0000-4000-8000-000000000002";
  const targetBId = "30000000-0000-4000-8000-000000000003";
  let cluster: EmbeddedPostgres;
  let databaseDir: string;
  let admin: ReturnType<EmbeddedPostgres["getPgClient"]>;
  let sessionA: ReturnType<EmbeddedPostgres["getPgClient"]>;
  let sessionB: ReturnType<EmbeddedPostgres["getPgClient"]>;

  beforeAll(async () => {
    databaseDir = await mkdtemp(join(tmpdir(), "systemops-lab-transfer-"));
    cluster = new EmbeddedPostgres({
      databaseDir,
      port: await reserveAvailablePort(),
      user: "postgres",
      password: "isolated-test-only",
      persistent: false,
      postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
      onLog: () => undefined,
      onError: () => undefined,
    });
    await cluster.initialise();
    await cluster.start();

    admin = cluster.getPgClient("postgres", "127.0.0.1");
    sessionA = cluster.getPgClient("postgres", "127.0.0.1");
    sessionB = cluster.getPgClient("postgres", "127.0.0.1");
    await Promise.all([admin.connect(), sessionA.connect(), sessionB.connect()]);
    await admin.query(`
      create table organizations (
        id uuid primary key,
        name text not null,
        is_test boolean not null default false,
        is_demo boolean not null default false,
        operational_status text not null default 'prospect',
        auto_reply_enabled boolean not null default false,
        shadow_mode_enabled boolean not null default false,
        channel_provider text,
        zapi_instance_id text,
        zapi_token text,
        zapi_client_token text,
        channel_paired_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create unique index organizations_zapi_instance_unique
        on organizations (zapi_instance_id)
        where zapi_instance_id is not null and btrim(zapi_instance_id) <> '';
    `);
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([admin?.end(), sessionA?.end(), sessionB?.end()]);
    if (cluster) await cluster.stop();
    if (databaseDir) await rm(databaseDir, { recursive: true, force: true });
  }, 60_000);

  beforeEach(async () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "44".repeat(32));
    await admin.query("drop trigger if exists delay_lab_transfer_detach on organizations");
    await admin.query("drop function if exists delay_lab_transfer_detach()");
    await admin.query("truncate organizations");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function insertOrganization(input: {
    id: string;
    name: string;
    instanceId?: string;
    token?: string;
  }): Promise<void> {
    await admin.query({
      text: `
        insert into organizations (
          id, name, is_test, is_demo, operational_status,
          auto_reply_enabled, shadow_mode_enabled,
          channel_provider, zapi_instance_id, zapi_token
        ) values ($1, $2, true, false, 'test', false, false, $3, $4, $5)
      `,
      values: [
        input.id,
        input.name,
        input.instanceId ? "z_api" : null,
        input.instanceId ?? null,
        input.token ?? null,
      ],
    });
  }

  it("atomically detaches an existing owner and assigns the Lab", async () => {
    await insertOrganization({
      id: sourceId,
      name: "Previous owner",
      instanceId: "instance-handoff",
      token: "previous-encrypted-value",
    });
    await insertOrganization({ id: targetAId, name: "SystemOps Lab" });
    const repository = new DrizzleSystemOpsLabChannelTransferRepository(
      drizzleNodePostgres(sessionA),
    );

    await repository.transfer({
      targetClinicId: targetAId,
      instanceId: "instance-handoff",
      rotatedToken: "synthetic-rotated-value",
      clientToken: null,
      expectedSourceClinicId: sourceId,
    });

    const result = await admin.query<{
      id: string;
      is_test: boolean;
      is_demo: boolean;
      operational_status: string;
      auto_reply_enabled: boolean;
      shadow_mode_enabled: boolean;
      channel_provider: string | null;
      zapi_instance_id: string | null;
      zapi_token: string | null;
    }>("select * from organizations order by id");
    const source = result.rows.find((row) => row.id === sourceId);
    const target = result.rows.find((row) => row.id === targetAId);

    expect(source).toMatchObject({
      channel_provider: null,
      zapi_instance_id: null,
      zapi_token: null,
    });
    expect(target).toMatchObject({
      is_test: true,
      is_demo: false,
      operational_status: "test",
      auto_reply_enabled: false,
      shadow_mode_enabled: false,
      channel_provider: "z_api",
      zapi_instance_id: "instance-handoff",
    });
    expect(target?.zapi_token).toMatch(/^enc:v1:/);
  }, 30_000);

  it("lets at most one cross-target transfer win under real lock contention", async () => {
    await insertOrganization({
      id: sourceId,
      name: "Contended owner",
      instanceId: "instance-contended",
      token: "previous-encrypted-value",
    });
    await insertOrganization({ id: targetAId, name: "Lab candidate A" });
    await insertOrganization({ id: targetBId, name: "Lab candidate B" });
    await admin.query(`
      create function delay_lab_transfer_detach() returns trigger
      language plpgsql as $$
      begin
        if old.zapi_instance_id = 'instance-contended'
          and new.zapi_instance_id is null then
          perform pg_sleep(0.2);
        end if;
        return new;
      end;
      $$;
      create trigger delay_lab_transfer_detach
        before update on organizations
        for each row execute function delay_lab_transfer_detach();
    `);
    const repositoryA = new DrizzleSystemOpsLabChannelTransferRepository(
      drizzleNodePostgres(sessionA),
    );
    const repositoryB = new DrizzleSystemOpsLabChannelTransferRepository(
      drizzleNodePostgres(sessionB),
    );

    const outcomes = await Promise.allSettled([
      repositoryA.transfer({
        targetClinicId: targetAId,
        instanceId: "instance-contended",
        rotatedToken: "synthetic-rotated-a",
        clientToken: null,
        expectedSourceClinicId: sourceId,
      }),
      repositoryB.transfer({
        targetClinicId: targetBId,
        instanceId: "instance-contended",
        rotatedToken: "synthetic-rotated-b",
        clientToken: null,
        expectedSourceClinicId: sourceId,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toEqual(
      new Error("Atomic Lab transfer rejected by database guard"),
    );

    const owners = await admin.query<{ id: string }>(
      "select id from organizations where zapi_instance_id = 'instance-contended'",
    );
    expect(owners.rows).toHaveLength(1);
    expect([targetAId, targetBId]).toContain(owners.rows[0]?.id);
    expect(owners.rows[0]?.id).not.toBe(sourceId);
  }, 30_000);
});
