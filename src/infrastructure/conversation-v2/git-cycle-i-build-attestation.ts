import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

declare const buildAttestationBrand: unique symbol;
export type CycleIBuildAttestation = Readonly<{
  commit: string;
  tree: string;
  treeDigest: HmacRef;
  sourceDigest: HmacRef;
  runtime: Readonly<{
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  }>;
  clean: true;
  readonly [buildAttestationBrand]: true;
}>;

const registered = new WeakSet<object>();
const objectId = /^[a-f0-9]{40,64}$/;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const trustedGitExecutable = "/usr/bin/git";
const statusEndMarker = "--CYCLE-I-STATUS-END--";
const implementationSourceScope = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "scripts/eval-conversation-v2-cycle-i-bootstrap.ts",
  "scripts/eval-conversation-v2-cycle-i.ts",
  "src",
]);
const closedGitEnvironment = Object.freeze({
  GIT_CONFIG_COUNT: "4",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_KEY_0: "core.fsmonitor",
  GIT_CONFIG_KEY_1: "core.trustctime",
  GIT_CONFIG_KEY_2: "core.checkStat",
  GIT_CONFIG_KEY_3: "core.untrackedCache",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_VALUE_1: "true",
  GIT_CONFIG_VALUE_2: "default",
  GIT_CONFIG_VALUE_3: "false",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_WORK_TREE: repositoryRoot,
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "production",
  PATH: "/usr/bin:/bin",
});

function digestTree(tree: string): HmacRef {
  return `hmac:${createHmac("sha256", "cycle-i-implementation-tree.v1")
    .update(tree)
    .digest("hex")}`;
}

type SourceEntry = Readonly<{
  path: string;
  mode: number;
  size: number;
  sha256: string;
}>;

export function computeCycleIImplementationSourceDigest(): HmacRef {
  const entries: SourceEntry[] = [];
  const paths = new Set<string>();
  const identities = new Set<string>();
  const rootPrefix = `${repositoryRoot}${sep}`;

  const visit = (absolutePath: string): void => {
    if (absolutePath !== repositoryRoot && !absolutePath.startsWith(rootPrefix)) {
      throw new Error("Cycle I implementation source path escaped the repository root");
    }
    const path = relative(repositoryRoot, absolutePath).split(sep).join("/");
    if (!path || path.includes("\0") || paths.has(path)) {
      throw new Error("Cycle I implementation source contains a duplicate or invalid path");
    }
    paths.add(path);
    const stat = lstatSync(absolutePath, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw new Error("Cycle I implementation source scope must not contain symlinks");
    }
    if (stat.isDirectory()) {
      const children = readdirSync(absolutePath)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      for (const child of children) visit(resolve(absolutePath, child));
      return;
    }
    if (!stat.isFile()) {
      throw new Error("Cycle I implementation source scope contains a non-regular file");
    }
    const descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isFile()) {
        throw new Error("Cycle I implementation source changed while being captured");
      }
      const identity = `${before.dev}:${before.ino}`;
      if (identities.has(identity)) {
        throw new Error("Cycle I implementation source scope contains hard-linked aliases");
      }
      identities.add(identity);
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor, { bigint: true });
      if (
        before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs
      ) throw new Error("Cycle I implementation source changed while being captured");
      entries.push(Object.freeze({
        path,
        mode: Number(before.mode & 0o777n),
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }));
    } finally {
      closeSync(descriptor);
    }
  };

  for (const scopedPath of implementationSourceScope) {
    visit(resolve(repositoryRoot, scopedPath));
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return `hmac:${createHmac("sha256", "cycle-i-implementation-source.v1")
    .update(JSON.stringify(entries))
    .digest("hex")}`;
}

export function createGitCycleIBuildAttestation(): CycleIBuildAttestation {
  // A single child-process boundary captures HEAD, its tree, and cleanliness.
  // The command, executable paths, cwd, and environment are closed constants. In
  // particular, caller-controlled PATH/GIT_DIR/GIT_WORK_TREE cannot redirect the
  // repository or substitute a different Git executable.
  const output = execFileSync(
    "/bin/sh",
    [
      "-c",
      `${trustedGitExecutable} rev-parse HEAD && ${trustedGitExecutable} rev-parse 'HEAD^{tree}' && ${trustedGitExecutable} status --porcelain=v1 --untracked-files=all --ignore-submodules=none && printf '%s\\n' '${statusEndMarker}' && ${trustedGitExecutable} ls-files -v`,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: closedGitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [commit, tree, ...remainder] = output.trimEnd().split("\n");
  if (!commit || !tree || !objectId.test(commit) || !objectId.test(tree)) {
    throw new Error("Cycle I build attestation could not resolve an exact Git HEAD/tree");
  }
  const statusEndIndex = remainder.indexOf(statusEndMarker);
  if (statusEndIndex < 0) {
    throw new Error("Cycle I build attestation could not verify Git index flags");
  }
  const status = remainder.slice(0, statusEndIndex);
  if (status.some((line) => line.length > 0)) {
    throw new Error("Cycle I productive measurement requires a clean repository tree");
  }
  const indexEntries = remainder.slice(statusEndIndex + 1).filter((line) => line.length > 0);
  if (indexEntries.some((line) => /^[a-zS] /.test(line))) {
    throw new Error(
      "Cycle I productive measurement rejects assume-unchanged or skip-worktree index flags",
    );
  }
  const attestation = Object.freeze({
    commit,
    tree,
    treeDigest: digestTree(tree),
    sourceDigest: computeCycleIImplementationSourceDigest(),
    runtime: Object.freeze({
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
    clean: true as const,
  }) as CycleIBuildAttestation;
  registered.add(attestation);
  return attestation;
}

export function isRegisteredCycleIBuildAttestation(
  input: CycleIBuildAttestation | undefined,
): input is CycleIBuildAttestation {
  return typeof input === "object" && input !== null && registered.has(input);
}
