import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeCycleIImplementationSourceDigest,
  createGitCycleIBuildAttestation,
  isRegisteredCycleIBuildAttestation,
} from "@/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const sourceReadOverride = vi.hoisted(() => ({
  path: null as string | null,
  bytes: null as Buffer | null,
  descriptors: new Set<number>(),
}));

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: ((...args: unknown[]) => {
      const descriptor = Reflect.apply(actual.openSync, actual, args) as number;
      if (args[0] === sourceReadOverride.path) sourceReadOverride.descriptors.add(descriptor);
      return descriptor;
    }) as typeof actual.openSync,
    readFileSync: ((...args: unknown[]) => {
      if (
        typeof args[0] === "number"
        && sourceReadOverride.descriptors.has(args[0])
        && sourceReadOverride.bytes !== null
      ) return Buffer.from(sourceReadOverride.bytes);
      return Reflect.apply(actual.readFileSync, actual, args);
    }) as typeof actual.readFileSync,
    closeSync: ((...args: unknown[]) => {
      if (typeof args[0] === "number") sourceReadOverride.descriptors.delete(args[0]);
      return Reflect.apply(actual.closeSync, actual, args);
    }) as typeof actual.closeSync,
  };
});
const git = vi.mocked(execFileSync);
// The attestation must pin Git to the repository that owns the module, whatever the
// checkout is named. Derived here from this file's own location, exactly as the module
// derives it from its own — never from a directory name, which differs on CI.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commit = "a".repeat(40);
const tree = "b".repeat(40);
const statusEnd = "--CYCLE-I-STATUS-END--";

describe("Cycle I build attestation", () => {
  beforeEach(() => {
    git.mockReset();
    sourceReadOverride.path = null;
    sourceReadOverride.bytes = null;
    sourceReadOverride.descriptors.clear();
  });

  it("does not let a caller select which repository is attested", () => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\nH src/relevant.ts\n`);
    expect(createGitCycleIBuildAttestation).toHaveLength(0);
    const attestation = createGitCycleIBuildAttestation();
    expect(attestation).toMatchObject({
      commit,
      tree,
      sourceDigest: expect.stringMatching(/^hmac:[a-f0-9]{64}$/),
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(isRegisteredCycleIBuildAttestation(attestation)).toBe(true);
    expect(Object.isFrozen(attestation)).toBe(true);
    expect(git).toHaveBeenCalledOnce();
    const options = git.mock.calls[0]![2] as { cwd: string };
    expect(options.cwd).toBe(repositoryRoot);
  });

  it("does not resolve Git or repository controls from the caller environment", () => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\nH src/relevant.ts\n`);
    const callerPath = process.env.PATH;
    const callerGitDir = process.env.GIT_DIR;
    const callerWorkTree = process.env.GIT_WORK_TREE;
    process.env.PATH = "/tmp/cycle-i-malicious-path";
    process.env.GIT_DIR = "/tmp/cycle-i-attacker-repository";
    process.env.GIT_WORK_TREE = "/tmp/cycle-i-clean-decoy";
    try {
      createGitCycleIBuildAttestation();
    } finally {
      if (callerPath === undefined) delete process.env.PATH;
      else process.env.PATH = callerPath;
      if (callerGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = callerGitDir;
      if (callerWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = callerWorkTree;
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
        GIT_WORK_TREE: repositoryRoot,
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
      },
    });
    expect((options as { env?: Record<string, string> }).env).not.toHaveProperty("GIT_DIR");
    expect((options as { env?: Record<string, string> }).env?.GIT_WORK_TREE)
      .toBe((options as { cwd: string }).cwd);
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

  it("changes the source digest for same-size bytes even when filesystem metadata and Git output are unchanged", () => {
    git.mockReturnValue(`${commit}\n${tree}\n${statusEnd}\nH src/relevant.ts\n`);
    sourceReadOverride.path = resolve(
      "src/infrastructure/conversation-v2/git-cycle-i-build-attestation.ts",
    );
    sourceReadOverride.bytes = Buffer.alloc(4_096, "a");
    try {
      const first = computeCycleIImplementationSourceDigest();
      sourceReadOverride.bytes = Buffer.alloc(4_096, "b");
      const second = computeCycleIImplementationSourceDigest();
      expect(second).not.toBe(first);
    } finally {
      sourceReadOverride.path = null;
      sourceReadOverride.bytes = null;
      sourceReadOverride.descriptors.clear();
    }
  });
});
