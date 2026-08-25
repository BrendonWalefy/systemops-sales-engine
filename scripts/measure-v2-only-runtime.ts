import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseRuntimePerformanceReport, evaluateRuntimePerformance } from "../src/application/conversation-v2/v2-runtime-performance";

function main(): void {
  const args = process.argv.slice(2);
  if (existsSync(".env.local")) throw new Error("measurement refuses .env.local");
  for (const credential of ["DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ZAPI_TOKEN", "ZAPI_INSTANCE_ID"]) {
    if (process.env[credential]?.trim()) throw new Error(`measurement refuses ${credential}`);
  }
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("measurement requires a clean git tree");
  const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1] ?? null; };
  const writePath = value("--write-baseline"); const baselinePath = value("--baseline");
  if (writePath && baselinePath) throw new Error("choose one baseline action");
  const directory = mkdtempSync(join(tmpdir(), "v2-runtime-performance-")); const output = join(directory, "report.json");
  try {
  execFileSync("npx", ["vitest", "run", "src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts", "--maxWorkers=1", "--silent"], { stdio: "inherit", env: { ...process.env, V2_RUNTIME_PERFORMANCE_OUTPUT: output } });
  const report = parseRuntimePerformanceReport(JSON.parse(readFileSync(output, "utf8")));
    if (writePath) {
      mkdirSync(dirname(writePath), { recursive: true });
      writeFileSync(writePath, JSON.stringify(report, null, 2) + "\n");
    } else if (baselinePath) {
      const baseline = parseRuntimePerformanceReport(JSON.parse(readFileSync(baselinePath, "utf8")));
      const evaluation = evaluateRuntimePerformance(report.arms[1], baseline.arms[0]);
      console.log(JSON.stringify({ passed: evaluation.passed, violations: evaluation.violations }));
      if (!evaluation.passed) process.exitCode = 1;
    } else {
      console.log(JSON.stringify(report));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

main();
