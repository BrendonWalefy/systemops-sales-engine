import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REPLAY_DATASET_SCHEMA_VERSION,
  type ReplayDatasetV2,
} from "@/application/replay/contracts";
import { assertReplayOutputOutsideGitRepository } from "@/application/replay/replay-export-policy";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inputPath = requiredAbsolutePath(argv, "--input");
  const outputPath = requiredAbsolutePath(argv, "--output");
  const resolvedInput = await realpath(inputPath);
  await Promise.all([
    assertReplayOutputOutsideGitRepository(path.dirname(resolvedInput)),
    assertReplayOutputOutsideGitRepository(path.dirname(outputPath)),
  ]);

  const dataset = JSON.parse(
    await readFile(resolvedInput, "utf8"),
  ) as ReplayDatasetV2;
  const review = renderReplayReview(dataset);
  await writeFile(outputPath, review, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    outputPath,
    datasetVersion: dataset.datasetVersion,
    scenarioCount: dataset.scenarioCount,
    status: dataset.status,
  }));
}

export function renderReplayReview(dataset: ReplayDatasetV2): string {
  assertNeedsReview(dataset);
  const lines = [
    "# Revisão humana do dataset de replay",
    "",
    "> ARQUIVO PRIVADO. Não compartilhe. O conteúdo foi sanitizado",
    "> automaticamente, mas ainda pode conter identificadores em texto livre.",
    "",
    `- Clínica: \`${escapeInline(dataset.clinic.clinicKey)}\``,
    `- Versão: \`${escapeInline(dataset.datasetVersion)}\``,
    `- Cenários: ${dataset.scenarioCount}`,
    `- Gerado em: ${dataset.generatedAt}`,
    "",
    "## Checklist obrigatório",
    "",
    "- [ ] Nenhum nome, telefone, email, documento, endereço, usuário ou URL real",
    "- [ ] Nenhum segredo, token, ID interno ou identificador de mídia",
    "- [ ] Placeholders de mídia não contêm URL",
    "- [ ] O texto ainda representa a intenção e a sequência originais",
    "- [ ] Todos os cenários abaixo foram revisados",
    "",
  ];

  dataset.scenarios.forEach((scenario, scenarioIndex) => {
    lines.push(
      `## ${scenarioIndex + 1}. ${escapeInline(scenario.id)}`,
      "",
      `- Origem opaca: \`${escapeInline(scenario.source.sourceRef)}\``,
      `- Tags: ${scenario.tags.map((tag) => `\`${escapeInline(tag)}\``).join(", ") || "nenhuma"}`,
      `- Turnos: ${scenario.turns.length}`,
      "",
    );
    scenario.turns.forEach((turn) => {
      lines.push(
        `### ${roleLabel(turn.author)} · +${formatOffset(turn.offsetMs)} · ${turn.content.type}`,
        "",
        ...escapeBlockquote(turn.content.text),
        "",
      );
    });
    lines.push("- [ ] Cenário revisado", "");
  });

  return `${lines.join("\n")}\n`;
}

function assertNeedsReview(dataset: ReplayDatasetV2): void {
  if (
    dataset.schemaVersion !== REPLAY_DATASET_SCHEMA_VERSION ||
    dataset.status !== "needs_review" ||
    dataset.approval !== null ||
    dataset.scenarioCount !== dataset.scenarios.length
  ) {
    throw new Error("Only a consistent needs_review replay dataset can be rendered");
  }
}

function roleLabel(author: string): string {
  if (author === "lead") return "LEAD";
  if (author === "agent") return "IA";
  if (author === "operator") return "EQUIPE";
  return "SISTEMA";
}

function formatOffset(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function escapeInline(value: string): string {
  return value.replace(/[`\\]/g, "\\$&");
}

function escapeBlockquote(value: string): string[] {
  const safe = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe.split(/\r?\n/).map((line) => `> ${line}`);
}

function requiredAbsolutePath(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value) throw new Error(`${flag} is required`);
  if (!path.isAbsolute(value)) {
    throw new Error(`${flag} must be an absolute path outside a Git repository`);
  }
  return value;
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
