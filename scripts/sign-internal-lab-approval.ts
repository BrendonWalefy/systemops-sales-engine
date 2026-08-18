import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeInternalLabRuntimeDigest,
  serializeInternalLabApprovalClaims,
  type DeploymentRuntime,
  type InternalLabApprovalClaims,
} from "../src/application/conversation-v2/internal-lab-approval";
import { createConfiguredCycleIRuntimeBuildIdentity } from "../src/application/conversation-v2/configured-cycle-i-authority";
import {
  INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN,
  assertConfiguredInternalLabAuthorityBindings,
  loadConfiguredInternalLabAuthority,
} from "../src/infrastructure/conversation-v2/configured-internal-lab-authority";
import { createGitCycleIBuildAttestation } from "../src/infrastructure/conversation-v2/git-cycle-i-build-attestation";
import {
  assertInternalLabRuntimeArtifactBindings,
  type InternalLabRuntimeArtifact,
} from "../src/application/conversation-v2/internal-lab-runtime-bindings";

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

async function readOwnerControlledFileOutsideWorktree(
  value: string,
  flag: "--private-key-file" | "--resolved-artifact-file",
): Promise<Buffer> {
  if (!isAbsolute(value)) throw new Error(`${flag} must be an absolute path`);
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, flag);
  const path = await realpath(lexicalPath);
  assertOutsideWorktree(path, flag);

  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await descriptor.stat({ bigint: true });
    const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
    if (
      !before.isFile()
      || (before.mode & 0o077n) !== 0n
      || (currentUid !== null && before.uid !== currentUid)
    ) {
      throw new Error(`${flag} must be an owner-controlled regular file with owner-only permissions`);
    }
    if (before.nlink !== 1n) {
      throw new Error(`${flag} must have a single link and no hard-link aliases`);
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
      throw new Error(`${flag} changed while being read`);
    }
    return bytes;
  } finally {
    await descriptor.close();
  }
}

async function validatePrivateKeyPath(value: string): Promise<void> {
  if (!isAbsolute(value)) throw new Error("--private-key-file must be an absolute path");
  const lexicalPath = resolve(value);
  assertOutsideWorktree(lexicalPath, "--private-key-file");
  const path = await realpath(lexicalPath);
  assertOutsideWorktree(path, "--private-key-file");
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await descriptor.stat({ bigint: true });
    const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
    if (
      !metadata.isFile()
      || (metadata.mode & 0o077n) !== 0n
      || (currentUid !== null && metadata.uid !== currentUid)
    ) {
      throw new Error("--private-key-file must be an owner-controlled regular file with owner-only permissions");
    }
    if (metadata.nlink !== 1n) {
      throw new Error("--private-key-file must have a single link and no hard-link aliases");
    }
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
  deploymentRuntime: DeploymentRuntime | null,
): void {
  // A approval é verificada no runtime do deploy, não no da máquina que assina.
  // Sem o runtime declarado do alvo, o campo ficaria preso ao runtime local e a
  // approval nasceria incapaz de passar em produção.
  const expected = {
    commitSha: build.commit,
    treeSha: build.tree,
    sourceDigest: build.sourceDigest,
    runtimeDigest: computeInternalLabRuntimeDigest(deploymentRuntime ?? build.runtime),
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

function parseDeploymentRuntime(serialized: string): DeploymentRuntime {
  const parsed = JSON.parse(serialized) as Partial<DeploymentRuntime>;
  if (
    typeof parsed?.nodeVersion !== "string"
    || !/^v\d+\.\d+\.\d+/.test(parsed.nodeVersion)
    || typeof parsed.platform !== "string"
    || parsed.platform.length === 0
    || typeof parsed.arch !== "string"
    || parsed.arch.length === 0
  ) {
    throw new Error("--deployment-runtime-file must declare nodeVersion, platform and arch");
  }
  return Object.freeze({
    nodeVersion: parsed.nodeVersion,
    platform: parsed.platform as NodeJS.Platform,
    arch: parsed.arch,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const privateKeyPath = requiredValue(argv, "--private-key-file");
  await validatePrivateKeyPath(privateKeyPath);
  const claimsPathValue = requiredValue(argv, "--claims-file");
  if (!isAbsolute(claimsPathValue)) throw new Error("--claims-file must be an absolute path");
  const claimsPath = await realpath(claimsPathValue);
  const outputValue = optionalValue(argv, "--output");
  const outputPath = outputValue ? await resolveOutputPath(outputValue) : null;
  const claimsBytes = await readFile(claimsPath, "utf8");
  const claims = JSON.parse(claimsBytes) as InternalLabApprovalClaims;
  const resolvedArtifactPathValue = requiredValue(argv, "--resolved-artifact-file");
  const resolvedArtifactBytes = await readOwnerControlledFileOutsideWorktree(
    resolvedArtifactPathValue,
    "--resolved-artifact-file",
  );
  let resolvedArtifact: InternalLabRuntimeArtifact;
  try {
    resolvedArtifact = JSON.parse(
      resolvedArtifactBytes.toString("utf8"),
    ) as InternalLabRuntimeArtifact;
  } finally {
    resolvedArtifactBytes.fill(0);
  }
  const deploymentRuntimeValue = optionalValue(argv, "--deployment-runtime-file");
  const deploymentRuntime = deploymentRuntimeValue === null
    ? null
    : parseDeploymentRuntime(await readFile(await realpath(deploymentRuntimeValue), "utf8"));
  const authority = loadConfiguredInternalLabAuthority();
  assertConfiguredInternalLabAuthorityBindings(authority, {
    tenantDigest: claims.tenantDigest,
    channelDigest: claims.channelDigest,
    configDigest: claims.configDigest,
  });
  assertInternalLabRuntimeArtifactBindings({
    tenantDigest: claims.tenantDigest,
    channelDigest: claims.channelDigest,
    configDigest: claims.configDigest,
  }, resolvedArtifact);
  const canonicalPayload = serializeInternalLabApprovalClaims(claims, new Date());
  const build = createGitCycleIBuildAttestation();
  const runtime = createConfiguredCycleIRuntimeBuildIdentity();
  assertExactBuild(claims, build, runtime, deploymentRuntime);
  const privateKeyBytes = await readOwnerControlledFileOutsideWorktree(
    privateKeyPath,
    "--private-key-file",
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
  const signatureBytes = sign(null, Buffer.concat([
    Buffer.from(INTERNAL_LAB_APPROVAL_AUTHORITY_DOMAIN),
    Buffer.from([0]),
    Buffer.from(canonicalPayload),
  ]), privateKey);
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
