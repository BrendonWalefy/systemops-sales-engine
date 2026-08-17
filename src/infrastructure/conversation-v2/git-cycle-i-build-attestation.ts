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

function digestTree(tree: string): HmacRef {
  return `hmac:${createHmac("sha256", "cycle-i-implementation-tree.v1")
    .update(tree)
    .digest("hex")}`;
}

export function createGitCycleIBuildAttestation(): CycleIBuildAttestation {
  // A single child-process boundary captures HEAD, its tree, and cleanliness.
  // The command is fixed; repositoryRoot is passed as cwd and is never interpolated.
  const output = execFileSync(
    "/bin/sh",
    ["-c", "git rev-parse HEAD && git rev-parse 'HEAD^{tree}' && git status --porcelain --untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
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
