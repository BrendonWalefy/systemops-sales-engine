import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReplayDatasetV2 } from "@/application/replay/contracts";
import { approveReplayDataset } from "@/application/replay/replay-dataset-approval";
import { assertReplayOutputOutsideGitRepository } from "@/application/replay/replay-export-policy";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inputPath = requiredAbsolutePath(argv, "--input");
  const outputPath = requiredAbsolutePath(argv, "--output");
  const privateKeyPath = requiredAbsolutePath(argv, "--private-key");
  const approvedBy = requiredValue(argv, "--reviewer");
  if (requiredValue(argv, "--confirm-reviewed") !== "YES") {
    throw new Error("--confirm-reviewed must be exactly YES after manual privacy review");
  }

  const [resolvedInput, resolvedPrivateKey] = await Promise.all([
    realpath(inputPath),
    realpath(privateKeyPath),
  ]);
  await Promise.all([
    assertReplayOutputOutsideGitRepository(path.dirname(resolvedInput)),
    assertReplayOutputOutsideGitRepository(path.dirname(resolvedPrivateKey)),
    assertReplayOutputOutsideGitRepository(path.dirname(outputPath)),
  ]);
  const [serialized, privateKeyPem] = await Promise.all([
    readFile(resolvedInput, "utf8"),
    readFile(resolvedPrivateKey),
  ]);
  const dataset = JSON.parse(serialized) as ReplayDatasetV2;
  const approved = approveReplayDataset({
    dataset,
    privateKeyPem,
    approvedAt: new Date(),
    approvedBy,
  });
  await writeFile(outputPath, `${JSON.stringify(approved, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    outputPath,
    datasetVersion: approved.datasetVersion,
    scenarioCount: approved.scenarioCount,
    status: approved.status,
    keyId: approved.approval?.keyId,
  }));
}

function requiredAbsolutePath(argv: string[], flag: string): string {
  const value = requiredValue(argv, flag);
  if (!path.isAbsolute(value)) {
    throw new Error(`${flag} must be an absolute path outside a Git repository`);
  }
  return value;
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
