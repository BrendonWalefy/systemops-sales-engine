import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitCycleIBuildAttestation, isRegisteredCycleIBuildAttestation } from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

describe("Cycle I build attestation", () => {
  it("registers the actual clean HEAD/tree and rejects a dirty relevant tree", () => {
    const root = mkdtempSync(join(tmpdir(), "cycle-i-build-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Cycle I Test"], { cwd: root });
    writeFileSync(join(root, "source.ts"), "export const value = 1;\n", "utf8");
    execFileSync("git", ["add", "source.ts"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    const attestation = createGitCycleIBuildAttestation(root);
    expect(isRegisteredCycleIBuildAttestation(attestation)).toBe(true);
    expect(attestation.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(attestation.tree).toMatch(/^[a-f0-9]{40}$/);
    writeFileSync(join(root, "source.ts"), "export const value = 2;\n", "utf8");
    expect(() => createGitCycleIBuildAttestation(root)).toThrow(/dirty|clean/i);
  });
});
