import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeInternalLabRuntimeDigest,
  serializeInternalLabApprovalClaims,
  type InternalLabApprovalClaims,
} from "../src/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "../src/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  loadConfiguredInternalLabAuthority,
} from "../src/infrastructure/conversation-v2/configured-internal-lab-authority";
import { createGitCycleIBuildAttestation } from "../src/infrastructure/conversation-v2/git-cycle-i-build-attestation";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function requiredValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a path`);
  return value;
}

function assertOutsideWorktree(path: string, flag: string): void {
  const relativePath = relative(repositoryRoot, path);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) {
    throw new Error(`${flag} must be outside the repository worktree`);
  }
}

async function readPrivateKeyOutsideWorktree(value: string): Promise<Buffer> {
  if (!isAbsolute(value)) throw new Error("--private-key-file must be an absolute path");
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, "--private-key-file");
  const path = await realpath(lexicalPath);
  assertOutsideWorktree(path, "--private-key-file");

  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await descriptor.stat({ bigint: true });
    const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
    if (
      !before.isFile()
      || (before.mode & 0o077n) !== 0n
      || (currentUid !== null && before.uid !== currentUid)
    ) {
      throw new Error("--private-key-file must be an owner-controlled regular file with owner-only permissions");
    }
    if (before.nlink !== 1n) {
      throw new Error("--private-key-file must have a single link and no hard-link aliases");
    }

    const bytes = await descriptor.readFile();
    const [after, pathAfter] = await Promise.all([
      descriptor.stat({ bigint: true }),
      stat(path, { bigint: true }),
    ]);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || after.dev !== pathAfter.dev
      || after.ino !== pathAfter.ino
    ) {
      bytes.fill(0);
      throw new Error("--private-key-file changed while being read");
    }
    return bytes;
  } finally {
    await descriptor.close();
  }
}

async function resolveOutputPath(value: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error("--output must be an absolute path");
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, "--output");
  const parent = await realpath(dirname(lexicalPath));
  const output = resolve(parent, basename(lexicalPath));
  assertOutsideWorktree(output, "--output");
  return output;
}

function assertExactBuild(
  claims: InternalLabApprovalClaims,
  build: ReturnType<typeof createGitCycleIBuildAttestation>,
  runtime: ReturnType<typeof createConfiguredCycleIRuntimeBuildIdentity>,
): void {
  const expected = {
    commitSha: build.commit,
    treeSha: build.tree,
    sourceDigest: build.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(build.runtime),
    cycleIGateDigest: runtime.reportDigest,
  } as const;
  if (runtime.commit !== build.commit) {
    throw new Error("configured runtime commit does not match the registered Git build attestation");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (claims[field as keyof typeof expected] !== value) {
      throw new Error(`Internal Lab approval claims do not match current ${field}`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const claimsPathValue = requiredValue(argv, "--claims-file");
  if (!isAbsolute(claimsPathValue)) throw new Error("--claims-file must be an absolute path");
  const claimsPath = await realpath(claimsPathValue);
  const outputValue = optionalValue(argv, "--output");
  const outputPath = outputValue ? await resolveOutputPath(outputValue) : null;
  const privateKeyBytes = await readPrivateKeyOutsideWorktree(
    requiredValue(argv, "--private-key-file"),
  );
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyBytes);
  } finally {
    privateKeyBytes.fill(0);
  }
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("--private-key-file must contain an Ed25519 private key");
  }

  const claimsBytes = await readFile(claimsPath, "utf8");
  const claims = JSON.parse(claimsBytes) as InternalLabApprovalClaims;
  const canonicalPayload = serializeInternalLabApprovalClaims(claims, new Date());
  const build = createGitCycleIBuildAttestation();
  const runtime = createConfiguredCycleIRuntimeBuildIdentity();
  assertExactBuild(claims, build, runtime);
  const signatureBytes = sign(null, Buffer.concat([
    Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
    Buffer.from([0]),
    Buffer.from(canonicalPayload),
  ]), privateKey);
  const authority = loadConfiguredInternalLabAuthority();
  if (!authority.verifyCanonicalPayload(Buffer.from(canonicalPayload), signatureBytes)) {
    throw new Error("private key does not match the configured Internal Lab authority root");
  }
  const approval = `${JSON.stringify({
    claims: JSON.parse(canonicalPayload),
    signature: `ed25519:${signatureBytes.toString("hex")}`,
  }, null, 2)}\n`;

  if (outputPath) {
    await writeFile(outputPath, approval, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } else {
    process.stdout.write(approval);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
