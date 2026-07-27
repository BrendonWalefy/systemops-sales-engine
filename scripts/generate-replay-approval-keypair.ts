import { generateKeyPairSync } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertReplayOutputOutsideGitRepository } from "@/application/replay/replay-export-policy";
import { replayApprovalKeyId } from "@/application/replay/replay-dataset-approval";

async function main(): Promise<void> {
  const outputDirectory = requiredValue(process.argv.slice(2), "--out-dir");
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("--out-dir must be an absolute path outside a Git repository");
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resolvedDirectory = await realpath(outputDirectory);
  await assertReplayOutputOutsideGitRepository(resolvedDirectory);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePath = path.join(resolvedDirectory, "replay-approval-private.pem");
  const publicPath = path.join(resolvedDirectory, "replay-approval-public.pem");
  await writeFile(
    privatePath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    publicPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644, flag: "wx" },
  );
  console.log(JSON.stringify({
    privatePath,
    publicPath,
    keyId: replayApprovalKeyId(publicKey),
  }));
}

function requiredValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
