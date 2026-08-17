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
const statusEnd = "--CYCLE-I-STATUS-END--";

describe("Cycle I build attestation", () => {
  beforeEach(() => git.mockReset());

  it("does not let a caller select which repository is attested", () => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\nH src/relevant.ts\n`);
    expect(createGitCycleIBuildAttestation).toHaveLength(0);
    const attestation = createGitCycleIBuildAttestation();
    expect(attestation).toMatchObject({ commit, tree, clean: true });
    expect(isRegisteredCycleIBuildAttestation(attestation)).toBe(true);
    expect(Object.isFrozen(attestation)).toBe(true);
    expect(git).toHaveBeenCalledOnce();
    const options = git.mock.calls[0]![2] as { cwd: string };
    expect(options.cwd).toMatch(/systemops-sales-engine-v2$/);
  });

  it("does not resolve Git or repository controls from the caller environment", () => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\nH src/relevant.ts\n`);
    const callerPath = process.env.PATH;
    const callerGitDir = process.env.GIT_DIR;
    process.env.PATH = "/tmp/cycle-i-malicious-path";
    process.env.GIT_DIR = "/tmp/cycle-i-attacker-repository";
    try {
      createGitCycleIBuildAttestation();
    } finally {
      if (callerPath === undefined) delete process.env.PATH;
      else process.env.PATH = callerPath;
      if (callerGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = callerGitDir;
    }

    const [executable, args, options] = git.mock.calls[0]!;
    expect(executable).toBe("/bin/sh");
    expect(args).toEqual([
      "-c",
      "/usr/bin/git rev-parse HEAD && /usr/bin/git rev-parse 'HEAD^{tree}' && /usr/bin/git status --porcelain=v1 --untracked-files=all --ignore-submodules=none && printf '%s\\n' '--CYCLE-I-STATUS-END--' && /usr/bin/git ls-files -v",
    ]);
    expect(options).toMatchObject({
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
      },
    });
    expect((options as { env?: Record<string, string> }).env).not.toHaveProperty("GIT_DIR");
    expect((options as { env?: Record<string, string> }).env).not.toHaveProperty("GIT_WORK_TREE");
  });

  it.each([
    ["staged change", "M  src/relevant.ts"],
    ["unstaged change", " M src/relevant.ts"],
    ["untracked source", "?? src/new.ts"],
    ["symlink/type change", " T src/relevant.ts"],
    ["dirty submodule", " M vendor/relevant-submodule"],
  ])("rejects a dirty tree containing a %s", (_label, statusLine) => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusLine}\n${statusEnd}\nH src/relevant.ts\n`);
    expect(() => createGitCycleIBuildAttestation()).toThrow(/clean|dirty|tree/i);
  });

  it.each([
    ["assume-unchanged", "h src/relevant.ts"],
    ["skip-worktree", "S src/relevant.ts"],
    ["assume-unchanged plus skip-worktree", "s src/relevant.ts"],
  ])("rejects the %s index flag even when status is empty", (_label, indexEntry) => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\n${indexEntry}\n`);
    expect(() => createGitCycleIBuildAttestation()).toThrow(/index|flag|clean|tree/i);
  });
});
