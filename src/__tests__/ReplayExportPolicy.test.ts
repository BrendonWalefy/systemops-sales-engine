import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertClinicAllowedForReplayExport,
  assertReplayOutputOutsideGitRepository,
} from "@/application/replay/replay-export-policy";
import {
  fingerprintReplayConfig,
  stableSerialize,
} from "@/application/replay/fingerprint-replay-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("replay export policy", () => {
  it("exige allowlist explícita e exata", () => {
    expect(() => assertClinicAllowedForReplayExport("clinic-a", undefined))
      .toThrow("explicit allowlist");
    expect(() => assertClinicAllowedForReplayExport("clinic-a", "clinic-b, clinic-c"))
      .toThrow("not allowed");
    expect(() => assertClinicAllowedForReplayExport("clinic-a", "clinic-b, clinic-a"))
      .not.toThrow();
  });

  it("recusa qualquer diretório dentro de um repositório Git", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replay-policy-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    const nested = path.join(root, "artifacts");
    await mkdir(nested);

    await expect(assertReplayOutputOutsideGitRepository(nested))
      .rejects.toThrow("outside every Git repository");
  });

  it("aceita diretório absoluto sem ancestral Git", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replay-policy-"));
    temporaryDirectories.push(root);

    await expect(assertReplayOutputOutsideGitRepository(root)).resolves.toBeUndefined();
  });
});

describe("fingerprintReplayConfig", () => {
  it("é estável para objetos equivalentes independentemente da ordem das chaves", () => {
    expect(stableSerialize({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableSerialize({ a: { c: 3, d: 4 }, b: 2 }));
    expect(fingerprintReplayConfig({ b: 2, a: 1 }))
      .toBe(fingerprintReplayConfig({ a: 1, b: 2 }));
  });
});
