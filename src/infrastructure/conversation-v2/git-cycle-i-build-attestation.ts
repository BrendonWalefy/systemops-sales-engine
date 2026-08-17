import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

declare const buildAttestationBrand: unique symbol;
export type CycleIBuildAttestation = Readonly<{
  commit: string;
  tree: string;
  treeDigest: HmacRef;
  clean: true;
  readonly [buildAttestationBrand]: true;
}>;

const registered = new WeakSet<object>();
const objectId = /^[a-f0-9]{40,64}$/;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const trustedGitExecutable = "/usr/bin/git";
const closedGitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
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

export function createGitCycleIBuildAttestation(): CycleIBuildAttestation {
  // A single child-process boundary captures HEAD, its tree, and cleanliness.
  // The command, executable paths, cwd, and environment are closed constants. In
  // particular, caller-controlled PATH/GIT_DIR/GIT_WORK_TREE cannot redirect the
  // repository or substitute a different Git executable.
  const output = execFileSync(
    "/bin/sh",
    [
      "-c",
      `${trustedGitExecutable} rev-parse HEAD && ${trustedGitExecutable} rev-parse 'HEAD^{tree}' && ${trustedGitExecutable} status --porcelain --untracked-files=all`,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: closedGitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const [commit, tree, ...status] = output.trimEnd().split("\n");
  if (!commit || !tree || !objectId.test(commit) || !objectId.test(tree)) {
    throw new Error("Cycle I build attestation could not resolve an exact Git HEAD/tree");
  }
  if (status.some((line) => line.length > 0)) {
    throw new Error("Cycle I productive measurement requires a clean repository tree");
  }
  const attestation = Object.freeze({
    commit,
    tree,
    treeDigest: digestTree(tree),
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
