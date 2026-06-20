import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "../src/infrastructure/db/schema";

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type JournalFile = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

type SnapshotFile = {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, unknown>;
  enums: Record<string, unknown>;
  schemas: Record<string, unknown>;
  sequences: Record<string, unknown>;
  roles: Record<string, unknown>;
  policies: Record<string, unknown>;
  views: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

type Report = {
  journalPath: string;
  latestTag: string | null;
  expectedSnapshotPath: string | null;
  missingJournalTags: string[];
  orphanJournalTags: string[];
  unexpectedSnapshotFiles: string[];
  missingSnapshot: boolean;
  staleSnapshot: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(__dirname, "../drizzle");
const metaDir = path.join(drizzleDir, "meta");
const journalPath = path.join(metaDir, "_journal.json");

function listSqlTags(): string[] {
  return fs
    .readdirSync(drizzleDir)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort()
    .map((file) => file.replace(/\.sql$/, ""));
}

function listSnapshotFiles(): string[] {
  return fs
    .readdirSync(metaDir)
    .filter((file) => /^\d+_snapshot\.json$/.test(file))
    .sort();
}

function listUnexpectedSnapshotFiles(): string[] {
  return fs
    .readdirSync(metaDir)
    .filter(
      (file) => file.endsWith("_snapshot.json") && !/^\d+_snapshot\.json$/.test(file),
    )
    .sort();
}

function readJournal(): JournalFile {
  return JSON.parse(fs.readFileSync(journalPath, "utf8")) as JournalFile;
}

function readSnapshot(snapshotPath: string): SnapshotFile {
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as SnapshotFile;
}

function getSnapshotStem(tag: string): string {
  const match = tag.match(/^(\d+)/);
  if (!match) {
    throw new Error(`Migration tag inválida para snapshot: ${tag}`);
  }
  return match[1];
}

function canonicalizeSnapshot(snapshot: SnapshotFile) {
  const { id, prevId, ...rest } = snapshot;
  void id;
  void prevId;
  return rest;
}

function getGitTimestampMs(tag: string): number {
  try {
    const output = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", path.join("drizzle", `${tag}.sql`)],
      {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
      },
    ).trim();
    const seconds = Number(output);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  } catch {
    // Fallback below.
  }

  return Date.now();
}

function buildExpectedSnapshot(prevId: string): SnapshotFile {
  return generateDrizzleJson(schema, prevId) as SnapshotFile;
}

function collectReport(): Report {
  const sqlTags = listSqlTags();
  const journal = readJournal();
  const journalTags = journal.entries.map((entry) => entry.tag);
  const latestTag = sqlTags.at(-1) ?? null;
  const latestSnapshotStem = latestTag ? getSnapshotStem(latestTag) : null;
  const expectedSnapshotPath = latestTag
    ? path.join(metaDir, `${latestSnapshotStem}_snapshot.json`)
    : null;
  const unexpectedSnapshotFiles = listUnexpectedSnapshotFiles();

  const missingJournalTags = sqlTags.filter((tag) => !journalTags.includes(tag));
  const orphanJournalTags = journalTags.filter((tag) => !sqlTags.includes(tag));

  if (!latestTag || !expectedSnapshotPath) {
    return {
      journalPath,
      latestTag,
      expectedSnapshotPath,
      missingJournalTags,
      orphanJournalTags,
      unexpectedSnapshotFiles,
      missingSnapshot: false,
      staleSnapshot: false,
    };
  }

  const missingSnapshot = !fs.existsSync(expectedSnapshotPath);
  if (missingSnapshot) {
    return {
      journalPath,
      latestTag,
      expectedSnapshotPath,
      missingJournalTags,
      orphanJournalTags,
      unexpectedSnapshotFiles,
      missingSnapshot: true,
      staleSnapshot: false,
    };
  }

  const snapshotFiles = listSnapshotFiles();
  const expectedSnapshot = readSnapshot(expectedSnapshotPath);
  const previousSnapshotFile = snapshotFiles
    .filter((file) => file !== path.basename(expectedSnapshotPath))
    .at(-1);
  const prevId = previousSnapshotFile
    ? readSnapshot(path.join(metaDir, previousSnapshotFile)).id
    : "00000000-0000-0000-0000-000000000000";
  const generatedSnapshot = buildExpectedSnapshot(prevId);
  generatedSnapshot.id = expectedSnapshot.id;
  generatedSnapshot.prevId = expectedSnapshot.prevId;

  return {
    journalPath,
    latestTag,
    expectedSnapshotPath,
    missingJournalTags,
    orphanJournalTags,
    unexpectedSnapshotFiles,
    missingSnapshot: false,
    staleSnapshot:
      JSON.stringify(canonicalizeSnapshot(expectedSnapshot)) !==
      JSON.stringify(canonicalizeSnapshot(generatedSnapshot)),
  };
}

function syncJournal(): void {
  const sqlTags = listSqlTags();
  const journal = readJournal();
  const byTag = new Map(journal.entries.map((entry) => [entry.tag, entry]));

  const entries = sqlTags.map((tag, idx) => {
    const existing = byTag.get(tag);
    return {
      idx,
      version: journal.version,
      when: existing?.when ?? getGitTimestampMs(tag),
      tag,
      breakpoints: existing?.breakpoints ?? true,
    } satisfies JournalEntry;
  });

  const nextJournal: JournalFile = {
    ...journal,
    entries,
  };

  fs.writeFileSync(journalPath, `${JSON.stringify(nextJournal, null, 2)}\n`);
}

function syncLatestSnapshot(): void {
  const sqlTags = listSqlTags();
  const latestTag = sqlTags.at(-1);
  if (!latestTag) return;
  const latestSnapshotStem = getSnapshotStem(latestTag);

  const snapshotFiles = listSnapshotFiles();
  const targetPath = path.join(metaDir, `${latestSnapshotStem}_snapshot.json`);
  const existing = fs.existsSync(targetPath) ? readSnapshot(targetPath) : null;
  const previousSnapshotFile = snapshotFiles
    .filter((file) => file !== path.basename(targetPath))
    .at(-1);
  const prevId = existing?.prevId
    ?? (previousSnapshotFile
      ? readSnapshot(path.join(metaDir, previousSnapshotFile)).id
      : "00000000-0000-0000-0000-000000000000");

  const snapshot = buildExpectedSnapshot(prevId);
  if (existing) {
    snapshot.id = existing.id;
    snapshot.prevId = existing.prevId;
  }

  for (const file of listUnexpectedSnapshotFiles()) {
    fs.rmSync(path.join(metaDir, file));
  }

  fs.writeFileSync(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function printReport(report: Report): void {
  if (report.missingJournalTags.length === 0
    && report.orphanJournalTags.length === 0
    && report.unexpectedSnapshotFiles.length === 0
    && !report.missingSnapshot
    && !report.staleSnapshot) {
    console.log("Drizzle meta OK.");
    return;
  }

  console.error("Drizzle meta inconsistente.");

  if (report.missingJournalTags.length > 0) {
    console.error(
      `- Migrations sem journal: ${report.missingJournalTags.join(", ")}`,
    );
  }

  if (report.orphanJournalTags.length > 0) {
    console.error(
      `- Entradas do journal sem arquivo SQL: ${report.orphanJournalTags.join(", ")}`,
    );
  }

  if (report.unexpectedSnapshotFiles.length > 0) {
    console.error(
      `- Snapshots fora do padrão: ${report.unexpectedSnapshotFiles.join(", ")}`,
    );
  }

  if (report.missingSnapshot && report.expectedSnapshotPath) {
    console.error(
      `- Snapshot ausente para a migration mais recente: ${path.basename(report.expectedSnapshotPath)}`,
    );
  }

  if (report.staleSnapshot && report.expectedSnapshotPath) {
    console.error(
      `- Snapshot desatualizado em relação ao schema atual: ${path.basename(report.expectedSnapshotPath)}`,
    );
  }
}

export function assertDrizzleMetaIsSane(): void {
  const report = collectReport();
  if (
    report.missingJournalTags.length > 0
    || report.orphanJournalTags.length > 0
    || report.unexpectedSnapshotFiles.length > 0
    || report.missingSnapshot
    || report.staleSnapshot
  ) {
    printReport(report);
    throw new Error(
      "Drizzle meta inconsistente. Rode `tsx scripts/check-drizzle-meta.ts --fix` e revise o diff.",
    );
  }
}

function main(): void {
  const shouldFix = process.argv.includes("--fix");

  if (shouldFix) {
    syncJournal();
    syncLatestSnapshot();
  }

  const report = collectReport();
  printReport(report);

  if (
    report.missingJournalTags.length > 0
    || report.orphanJournalTags.length > 0
    || report.unexpectedSnapshotFiles.length > 0
    || report.missingSnapshot
    || report.staleSnapshot
  ) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
