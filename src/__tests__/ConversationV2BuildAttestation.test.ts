import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitCycleIBuildAttestation,
  isRegisteredCycleIBuildAttestation,
} from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const git = vi.mocked(execFileSync);
const commit = "a".repeat(40);
const tree = "b".repeat(40);

describe("Cycle I build attestation", () => {
  beforeEach(() => git.mockReset());

  it("does not let a caller select which repository is attested", () => {
    git.mockReturnValue(`${commit}\n${tree}\n`);
    expect(createGitCycleIBuildAttestation).toHaveLength(0);
    const attestation = createGitCycleIBuildAttestation();
    expect(attestation).toMatchObject({ commit, tree, clean: true });
    expect(isRegisteredCycleIBuildAttestation(attestation)).toBe(true);
    expect(Object.isFrozen(attestation)).toBe(true);
    expect(git).toHaveBeenCalledOnce();
    const options = git.mock.calls[0]![2] as { cwd: string };
    expect(options.cwd).toMatch(/systemops-sales-engine-v2$/);
  });

  it("rejects a dirty relevant tree instead of issuing an attestation", () => {
    git.mockReturnValue(`${commit}\n${tree}\n M src/relevant.ts\n`);
    expect(() => createGitCycleIBuildAttestation()).toThrow(/clean|dirty|tree/i);
  });
});
