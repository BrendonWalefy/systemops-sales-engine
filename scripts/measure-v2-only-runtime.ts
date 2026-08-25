import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { parseRuntimePerformanceReport, evaluateRuntimePerformance } from "../src/application/conversation-v2/v2-runtime-performance";

type BaselineAction = Readonly<{ kind: "write" | "compare"; path: string }> | null;

function parseAction(args: readonly string[]): BaselineAction {
  let action: BaselineAction = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag !== "--write-baseline" && flag !== "--baseline") {
      throw new Error(`unknown measurement argument: ${flag}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (action) throw new Error("choose one baseline action");
    action = { kind: flag === "--write-baseline" ? "write" : "compare", path: value };
    index += 1;
  }
  return action;
}

function rejectUnsafeParentEnvironment(): void {
  const forbidden = Object.entries(process.env).find(([key, value]) => value?.trim() && (
    /^(?:DATABASE_URL|TEST_DATABASE_HOST|PRODUCTION_DATABASE_HOST|PG[A-Z_]*|POSTGRES(?:QL)?(?:_|$)|DB_(?:HOST|PORT|USER|PASSWORD|NAME)|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|DYLD_INSERT_LIBRARIES)$/i.test(key)
    || /(?:^|_)(?:HTTP|HTTPS|ALL|NO)_?PROXY$/i.test(key)
    || /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIALS?|API_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PRIVATE_KEY)(?:_|$)/i.test(key)
    || /(?:OPENAI|ANTHROPIC|ZAPI|WHATSAPP|NEON).*(?:KEY|TOKEN|SECRET|URL|CREDENTIAL|INSTANCE)/i.test(key)
  ));
  if (forbidden) throw new Error(`measurement refuses inherited ${forbidden[0]}`);
}

function resolveVitestCli(): string {
  const nodeModules = realpathSync(join(process.cwd(), "node_modules"));
  const cli = realpathSync(join(nodeModules, "vitest", "vitest.mjs"));
  if (!cli.startsWith(`${nodeModules}${sep}`)) throw new Error("measurement CLI escaped repository node_modules");
  return cli;
}

function main(): void {
  const args = process.argv.slice(2);
  const action = parseAction(args);
  if (existsSync(".env.local")) throw new Error("measurement refuses .env.local");
  rejectUnsafeParentEnvironment();
  const gitEnvironment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", NODE_ENV: "test" as const };
  if (execFileSync("/usr/bin/git", ["status", "--porcelain"], { encoding: "utf8", env: gitEnvironment }).trim()) throw new Error("measurement requires a clean git tree");
  const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { encoding: "utf8", env: gitEnvironment }).trim();
  const directory = mkdtempSync(join(tmpdir(), "v2-runtime-performance-")); const output = join(directory, "report.json");
  try {
    execFileSync(process.execPath, [resolveVitestCli(), "run", "src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts", "--maxWorkers=1", "--silent"], {
      stdio: "inherit",
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
        TMPDIR: tmpdir(),
        NODE_ENV: "test",
        CI: "1",
        NO_COLOR: "1",
        V2_RUNTIME_PERFORMANCE_OUTPUT: output,
        V2_RUNTIME_PERFORMANCE_COMMIT: commit,
      },
    });
    const report = parseRuntimePerformanceReport(JSON.parse(readFileSync(output, "utf8")));
    if (action?.kind === "write") {
      mkdirSync(dirname(action.path), { recursive: true });
      writeFileSync(action.path, JSON.stringify(report, null, 2) + "\n");
    } else if (action?.kind === "compare") {
      const baseline = parseRuntimePerformanceReport(JSON.parse(readFileSync(action.path, "utf8")));
      const evaluation = evaluateRuntimePerformance(report.arms[1], baseline.arms[0]);
      console.log(JSON.stringify({ passed: evaluation.passed, violations: evaluation.violations }));
      if (!evaluation.passed) process.exitCode = 1;
    } else {
      console.log(JSON.stringify(report));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

main();
