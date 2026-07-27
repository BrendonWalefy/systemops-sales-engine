import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertReplayOutputOutsideGitRepository } from "../src/application/replay/replay-export-policy";

const execute = promisify(execFile);

async function main() {
  const values = process.argv.slice(2);
  const deleteBranchId = readArg(values, "--delete-branch");
  if (deleteBranchId) {
    if (readArg(values, "--confirm") !== deleteBranchId) {
      throw new Error("Deletion requires --confirm with the exact branch id");
    }
    await neonctl(["branches", "delete", deleteBranchId, "--project-id", requiredEnv("NEON_PROJECT_ID")]);
    console.log(JSON.stringify({ deletedBranchId: deleteBranchId }));
    return;
  }

  const output = readArg(values, "--output");
  if (!output) throw new Error("Creation requires --output <absolute-manifest.json>");
  const resolvedOutput = path.resolve(output);
  await assertReplayOutputOutsideGitRepository(resolvedOutput);
  const projectId = requiredEnv("NEON_PROJECT_ID");
  const parentId = requiredEnv("NEON_REPLAY_PARENT_BRANCH_ID");
  requiredEnv("NEON_API_KEY");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const name = `replay-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const createOutput = await neonctl([
    "branches", "create",
    "--project-id", projectId,
    "--parent", parentId,
    "--name", name,
    "--expires-at", expiresAt,
    "--output", "json",
  ]);
  const created = JSON.parse(createOutput) as {
    branch?: { id?: string; name?: string };
    id?: string;
  };
  const branchId = created.branch?.id ?? created.id;
  if (!branchId || !/^br-[a-z0-9-]+$/.test(branchId)) {
    throw new Error("Neon CLI did not return a valid branch id");
  }
  const databaseUrl = (await neonctl([
    "connection-string", branchId,
    "--project-id", projectId,
    "--pooled",
  ])).trim();
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("Neon CLI did not return a Postgres connection string");
  }
  const host = new URL(databaseUrl).hostname;
  const manifest = {
    schemaVersion: "replay-sandbox.v1",
    projectId,
    parentBranchId: parentId,
    branchId,
    branchName: created.branch?.name ?? name,
    expiresAt,
    databaseHost: host,
    // Arquivo privado 0600 fora do Git. Nunca imprimir a URL no terminal.
    databaseUrl,
  };
  await writeFile(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    output: resolvedOutput,
    branchId,
    branchName: manifest.branchName,
    expiresAt,
    databaseHost: host,
  }));
}

async function neonctl(args: string[]): Promise<string> {
  const { stdout } = await execute("npx", ["--yes", "neonctl@latest", ...args], {
    env: process.env,
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout;
}

function readArg(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
