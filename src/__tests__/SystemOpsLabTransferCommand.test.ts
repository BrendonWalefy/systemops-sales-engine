import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

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
