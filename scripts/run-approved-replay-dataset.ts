import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReplayCalendarSnapshotV1,
  ReplayDatasetV2,
} from "../src/application/replay/contracts";
import { verifyReplayDatasetApproval } from "../src/application/replay/replay-dataset-approval";
import { assertReplayOutputOutsideGitRepository } from "../src/application/replay/replay-export-policy";

type Args = {
  dataset: string;
  publicKey: string;
  endpoint: string;
  secret: string;
  output: string;
  calendarSnapshot?: string;
  repetitions: number;
};

type ReplayBatchResult = {
  scenarioId: string;
  mode: "closed_loop" | "concurrency";
  repetition: number;
  httpStatus: number;
  golden: boolean;
  passed: boolean;
  result: unknown;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await assertReplayOutputOutsideGitRepository(args.output);
  const dataset = JSON.parse(await readFile(args.dataset, "utf8")) as ReplayDatasetV2;
  const publicKey = await readFile(args.publicKey, "utf8");
  verifyReplayDatasetApproval(dataset, publicKey);
  const calendarSnapshot = args.calendarSnapshot
    ? JSON.parse(await readFile(args.calendarSnapshot, "utf8")) as ReplayCalendarSnapshotV1
    : undefined;
  const results: ReplayBatchResult[] = [];

  for (const scenario of dataset.scenarios) {
    const modes = scenario.compatibleModes.filter(
      (mode): mode is "closed_loop" | "concurrency" =>
        mode === "closed_loop" || mode === "concurrency",
    );
    for (const mode of modes) {
      for (let repetition = 1; repetition <= args.repetitions; repetition++) {
        const runId = [dataset.datasetVersion, scenario.id, mode, repetition]
          .join(":")
          .replace(/[^a-zA-Z0-9._:-]/g, "-")
          .slice(0, 160);
        const response = await fetch(args.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-e2e-secret": args.secret,
          },
          body: JSON.stringify({ runId, mode, scenario, calendarSnapshot }),
        });
        const body = await response.json().catch(() => ({ error: "invalid_json_response" }));
        results.push({
          scenarioId: scenario.id,
          mode,
          repetition,
          httpStatus: response.status,
          golden: scenario.expectations !== undefined,
          passed: response.ok,
          result: body,
        });
      }
    }
  }

  const goldenResults = results.filter((result) => result.golden);
  const legacyResults = results.filter((result) => !result.golden);
  const passedCount = results.filter((result) => result.passed).length;
  const goldenPassedCount = goldenResults.filter((result) => result.passed).length;
  const legacyPassedCount = legacyResults.filter((result) => result.passed).length;
  const report = {
    schemaVersion: "replay-batch-run.v1",
    datasetVersion: dataset.datasetVersion,
    datasetApprovalKeyId: dataset.approval?.keyId ?? null,
    executedAt: new Date().toISOString(),
    repetitionCount: args.repetitions,
    runCount: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    goldenRunCount: goldenResults.length,
    goldenPassedCount,
    goldenFailedCount: goldenResults.length - goldenPassedCount,
    legacyRunCount: legacyResults.length,
    legacyPassedCount,
    legacyFailedCount: legacyResults.length - legacyPassedCount,
    results,
  };
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    output: path.resolve(args.output),
    runCount: report.runCount,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    goldenRunCount: report.goldenRunCount,
    goldenPassedCount: report.goldenPassedCount,
    goldenFailedCount: report.goldenFailedCount,
    legacyRunCount: report.legacyRunCount,
    legacyPassedCount: report.legacyPassedCount,
    legacyFailedCount: report.legacyFailedCount,
    status: report.failedCount === 0 ? "passed" : "failed",
  }));
  if (report.failedCount > 0) process.exitCode = 1;
}

function parseArgs(values: string[]): Args {
  const read = (name: string) => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const dataset = read("--dataset");
  const publicKey = read("--public-key");
  const endpoint = read("--endpoint");
  const secret = read("--secret");
  const output = read("--output");
  const repetitions = Number(read("--repetitions") ?? 1);
  if (!dataset || !publicKey || !endpoint || !secret || !output) {
    throw new Error(
      "Usage: --dataset <approved.json> --public-key <pem> --endpoint <url> --secret <e2e> --output <json> [--calendar-snapshot <json>] [--repetitions N]",
    );
  }
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
    throw new Error("--repetitions must be an integer between 1 and 20");
  }
  return {
    dataset: path.resolve(dataset),
    publicKey: path.resolve(publicKey),
    endpoint,
    secret,
    output: path.resolve(output),
    calendarSnapshot: read("--calendar-snapshot")
      ? path.resolve(read("--calendar-snapshot")!)
      : undefined,
    repetitions,
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
