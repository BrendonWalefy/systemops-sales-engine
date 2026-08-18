import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && (path.endsWith(".ts") || path.endsWith(".tsx")) ? [path] : [];
  });
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const packageScripts: Readonly<Record<string, string>> = JSON.parse(read("package.json")).scripts;
const runbookPath = "docs/operations/systemops-lab-runbook.md";
const runbook = read(runbookPath);
const readme = read("README.md");

/** Lab vocabulary that must never become a durable schema object or an extra worker. */
const labVocabulary = /internal_lab|systemops_lab|lab_run|persona|evidence_run|approval_registry/i;

/** Frozen worker surface: the Lab reuses `message.process` / `message.send` and adds none. */
const approvedCronRoutes = Object.freeze([
  "appointment-reminder",
  "appointment-reminder-staff",
  "calendar-watch-renew",
  "channel-health-alert",
  "channel-health-snapshot",
  "conversation-analytics",
  "conversation-insights",
  "decision-trace-cleanup",
  "deposit-expiry-sweep",
  "follow-up-dispatcher",
  "lead-outcome-classifier",
  "media-cleanup",
  "message-worker",
  "metrics-aggregate",
  "operational-alert-digest",
  "post-appointment-followup",
  "recovery-campaign",
  "recovery-campaign-evening",
  "resume-expired-takeovers",
  "sender-worker",
  "stale-conversations",
  "stuck-conversation-sweep",
  "tts-cleanup",
]);

function unapprovedNewWorkers(): string[] {
  const cronRoutes = readdirSync("src/app/api/cron", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !approvedCronRoutes.includes(name))
    .sort();
  const queueNames = read("src/application/ports/job-queue.ts")
    .match(/export type JobQueueName = [^;]+;/)?.[0] ?? "";
  const extraQueues = [...queueNames.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => !["message.process", "message.send", "followup.dispatch"].includes(name));
  return [...cronRoutes, ...extraQueues].sort();
}

function unapprovedSchemaChanges(): string[] {
  const schemaTables = [...read("src/infrastructure/db/schema.ts").matchAll(/pgTable\(\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((table) => labVocabulary.test(table));
  const migrations = readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => {
      const statements = read(join("drizzle", file))
        .match(/(?:CREATE|ALTER|DROP)\s+TABLE[^;]*/gi) ?? [];
      return statements.some((statement) => labVocabulary.test(statement));
    });
  return [...schemaTables, ...migrations].sort();
}

function unapprovedDashboardsOrInbox(): string[] {
  return sourceFiles("src/app")
    .filter((path) => /@\/application\/labs\/|systemops-lab|internal-lab-synthetic-delivery/.test(read(path)))
    .map((path) => relative(".", path))
    .sort();
}

describe("SystemOps Lab scope", () => {
  it("keeps Lab additions inside the approved file families", () => {
    expect(unapprovedNewWorkers()).toEqual([]);
    expect(unapprovedSchemaChanges()).toEqual([]);
    expect(unapprovedDashboardsOrInbox()).toEqual([]);
  });

  it("keeps Lab application modules behind the approved runtime and tooling consumers", () => {
    const consumers = [...sourceFiles("src"), ...sourceFiles("scripts")]
      .filter((path) => !path.includes(`${join("src", "__tests__")}`))
      .filter((path) => !path.startsWith(join("src", "application", "labs")))
      .filter((path) => /(?:from|import)\s*\(?\s*["'](?:@\/|\.\.\/src\/)application\/labs\//.test(read(path)))
      .map((path) => relative(".", path))
      .sort();

    expect(consumers).toEqual([
      "scripts/configure-systemops-dental-lab.ts",
      "scripts/render-systemops-lab-evidence.ts",
      "scripts/run-systemops-lab-personas.ts",
      "scripts/transfer-systemops-lab-channel.ts",
      "scripts/verify-systemops-lab.ts",
      "src/application/jobs/send-message-job.ts",
      "src/infrastructure/repositories/drizzle-systemops-lab-channel-transfer-repository.ts",
    ]);
  });

  it("keeps Lab modules on application ports instead of a parallel infrastructure path", () => {
    const offenders = sourceFiles("src/application/labs")
      .map((path) => ({ path: relative(".", path), source: read(path) }))
      .filter(({ source }) => /from\s+["'](?:@\/infrastructure\/|drizzle-orm|next\/|@\/app\/)/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("keeps committed Lab artifacts inside the four approved evidence names", () => {
    const artifacts = sourceArtifacts("evals/systemops-lab");
    const offenders = artifacts.filter((path) => {
      const parts = relative("evals/systemops-lab", path).split("/");
      if (parts.length === 2 && parts[0] === "personas") return !parts[1]!.endsWith(".json");
      if (parts.length === 1) return parts[0] !== "latest-summary.md";
      return parts.length !== 2
        || !["transcript.md", "trace.json", "evaluation.json"].includes(parts[1]!);
    });
    expect(offenders).toEqual([]);
  });
});

function sourceArtifacts(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceArtifacts(path) : [path];
  });
}

type RunbookCommand = Readonly<{ line: string; script: string | null; flags: readonly string[] }>;

function runbookCommands(): readonly RunbookCommand[] {
  const blocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!);
  return blocks.flatMap((block) => block
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => ({
      line,
      script: /(?:^|\s)npm run ([\w:-]+)/.exec(line)?.[1] ?? null,
      flags: [...line.matchAll(/(?:^|\s)(--[a-z][a-z-]+)/g)].map((match) => match[1]!),
    })));
}

function scriptEntrypoint(npmScript: string): string | null {
  return /tsx\s+(scripts\/[\w.-]+\.ts)/.exec(packageScripts[npmScript] ?? "")?.[1] ?? null;
}

/** A trusted bootstrap parses no flag itself, so the delegated script sources count too. */
function scriptArgumentSurface(entrypoint: string): string {
  const source = read(entrypoint);
  const delegated = [...source.matchAll(/["']\.\/([\w.-]+)["']/g)]
    .map((match) => join("scripts", `${match[1]!}.ts`))
    .filter((path) => existsSync(path));
  return [source, ...delegated.map(read)].join("\n");
}

const environmentNames = new Set<string>([
  ...[...read(".env.example").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!),
  ...[...sourceFiles("src").filter((path) => !path.includes(join("src", "__tests__"))),
    ...sourceFiles("scripts")]
    .flatMap((path) => {
      const source = read(path);
      return [
        ...[...source.matchAll(/(?:process\.)?env(?:\.|\[")([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]!),
        ...[...source.matchAll(/requiredEnv(?:ironment)?\([^)]*"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]!),
      ];
    }),
]);

const approvalVocabulary = new Set(
  [...read("src/application/conversation-v2/internal-lab-approval.ts")
    .matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]!),
);

describe("SystemOps Lab runbook", () => {
  it("documents every Lab entrypoint that exists in package.json", () => {
    const labScripts = Object.keys(packageScripts)
      .filter((name) => name.startsWith("lab:") || name === "eval:conversation-v2:cycle-i");
    const undocumented = labScripts
      .filter((name) => !runbookCommands().some((command) => command.script === name))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("only documents commands that the repository can actually execute", () => {
    const missingScripts = runbookCommands()
      .filter((command) => command.script !== null && !(command.script in packageScripts))
      .map((command) => command.script!);
    const missingFiles = [...runbook.matchAll(/(scripts\/[\w.-]+\.ts)/g)]
      .map((match) => match[1]!)
      .filter((path) => !existsSync(path));

    expect([...new Set([...missingScripts, ...missingFiles])].sort()).toEqual([]);
  });

  it("only documents flags the target script parses", () => {
    const offenders = runbookCommands().flatMap((command) => {
      if (command.script === null) return [];
      const entrypoint = scriptEntrypoint(command.script);
      if (entrypoint === null || !existsSync(entrypoint)) return [];
      const source = scriptArgumentSurface(entrypoint);
      return command.flags
        .filter((flag) => !source.includes(`"${flag}"`))
        .map((flag) => `${command.script} ${flag}`);
    });

    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("only references environment variables the runtime reads", () => {
    const referenced = [
      ...[...runbook.matchAll(/\$(?:\{)?([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]!),
      ...[...runbook.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!),
      // Prose names an env var in backticks. Closed approval vocabulary shares the shape
      // (INTERNAL_LAB_READY, NO_GO), so it is excluded by identity rather than by prefix.
      ...[...runbook.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)]
        .map((match) => match[1]!)
        .filter((name) => !approvalVocabulary.has(name)),
    ];
    expect(new Set(referenced).size).toBeGreaterThan(10);

    const unknown = [...new Set(referenced)]
      .filter((name) => !environmentNames.has(name))
      .sort();

    expect(unknown).toEqual([]);
  });

  it("documents the closed readiness phases exactly as the verifier accepts them", () => {
    const phases = [...(/export type SystemOpsLabReadinessPhase =([^;]+);/
      .exec(read("src/application/labs/systemops-lab-readiness.ts"))?.[1] ?? "")
      .matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    expect(phases.length).toBeGreaterThan(0);
    const commands = runbookCommands();
    const undocumented = [...new Set(phases)]
      .filter((phase) => !commands.some((command) =>
        command.line.includes(`SYSTEMOPS_LAB_READINESS_PHASE=${phase}`)
        && command.script === "lab:verify"))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("documents both approval decisions, every criterion and every evidence kind", () => {
    const approvalSource = read("src/application/conversation-v2/internal-lab-approval.ts");
    const closedList = (name: string): readonly string[] => [
      ...(new RegExp(`const ${name} = Object.freeze\\(\\[([\\s\\S]*?)\\]`).exec(approvalSource)?.[1] ?? "")
        .matchAll(/"([^"]+)"/g),
    ].map((match) => match[1]!);

    const decisions = [...(/decision: z\.enum\(\[([^\]]*)\]/.exec(approvalSource)?.[1] ?? "")
      .matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    const criteria = [...closedList("smokeCriteria"), ...closedList("readyCriteria")];
    const evidenceKinds = [
      ...closedList("smokeEvidenceKinds"),
      ...closedList("readyEvidenceKinds"),
    ];

    expect(decisions).toHaveLength(2);
    expect(criteria.length).toBeGreaterThan(10);
    expect(evidenceKinds.length).toBeGreaterThan(2);

    // Backticked match: `inbox` must be its own token, not a slice of inbox_persistence_green.
    const undocumented = [...new Set([...decisions, ...criteria, ...evidenceKinds])]
      .filter((token) => !runbook.includes(`\`${token}\``))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("gives every activation step an expected decision and a return-to-V1 condition", () => {
    // Section 13 is the index of the sequence; every step after it is a gate.
    const activationSections = runbook.split(/^## /m).slice(1)
      .filter((section) => Number.parseInt(section, 10) >= 14);
    expect(activationSections.length).toBeGreaterThan(10);

    const incomplete = activationSections
      .filter((section) => !section.includes("**Precondition:**")
        || !section.includes("**Expected:**")
        || !section.includes("**Retorna a V1 se:**"))
      .map((section) => section.split("\n")[0]!)
      .sort();

    expect(incomplete).toEqual([]);
  });

  it("pairs every mutating command with its documented rollback path", () => {
    const commands = runbookCommands();
    const mutating = commands.filter((command) =>
      command.flags.includes("--apply") || command.flags.includes("--execute"));
    expect(mutating.length).toBeGreaterThan(0);

    const rollbackDocumented = commands.some((command) =>
      command.flags.includes("--rollback-snapshot"));
    expect(rollbackDocumented).toBe(true);
    expect(runbook).toContain("V2 -> V1 -> V2");
    expect(runbook).toContain("OWNER REVIEW: PENDING");
    expect(runbook).toContain("npm run verify");
  });

  it("keeps every documentation link resolvable from the repository", () => {
    const links = [runbookPath, "README.md"].flatMap((path) =>
      [...read(path).matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)]
        .map((match) => ({ from: path, target: match[1]! })));
    const broken = links
      .filter(({ from, target }) => !existsSync(resolve(dirname(from), target)))
      .map(({ from, target }) => `${from} -> ${target}`)
      .sort();

    expect(broken).toEqual([]);
  });

  it("keeps README aligned with the closed engine vocabulary and the runbook", () => {
    expect(readme).toContain(runbookPath);

    const declared = [...(/pgEnum\("conversation_engine",\s*\[([^\]]*)\]/
      .exec(read("src/infrastructure/db/schema.ts"))?.[1] ?? "")
      .matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    expect(declared.filter((engine) => !readme.includes(`\`${engine}\``))).toEqual([]);

    const referencedModules = [...readme.matchAll(/\bsrc\/[\w./-]+\.ts\b/g)]
      .map((match) => match[0])
      .filter((path) => !existsSync(path));
    expect(referencedModules).toEqual([]);
  });
});
