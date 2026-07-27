/**
 * Reemite um dataset já aprovado com fingerprints de uma nova configuração,
 * preservando byte a byte o conteúdo conversacional revisado.
 *
 * A saída volta para needs_review e sem assinatura. O script de aprovação
 * continua sendo obrigatório; esta ferramenta nunca transfere uma assinatura.
 */
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReplayDatasetV2,
  ReplayScenarioV1,
} from "@/application/replay/contracts";
import { assertReplayOutputOutsideGitRepository } from "@/application/replay/replay-export-policy";

async function main() {
  const argv = process.argv.slice(2);
  const approvedPath = requiredAbsolutePath(argv, "--approved");
  const configTemplatePath = requiredAbsolutePath(argv, "--config-template");
  const outputPath = requiredAbsolutePath(argv, "--output");
  const [approvedRealPath, templateRealPath] = await Promise.all([
    realpath(approvedPath),
    realpath(configTemplatePath),
  ]);
  await Promise.all([
    assertReplayOutputOutsideGitRepository(path.dirname(approvedRealPath)),
    assertReplayOutputOutsideGitRepository(path.dirname(templateRealPath)),
    assertReplayOutputOutsideGitRepository(path.dirname(outputPath)),
  ]);

  const [approved, template] = await Promise.all([
    readFile(approvedRealPath, "utf8").then((value) =>
      JSON.parse(value) as ReplayDatasetV2),
    readFile(templateRealPath, "utf8").then((value) =>
      JSON.parse(value) as ReplayDatasetV2),
  ]);
  if (approved.status !== "approved" || !approved.approval) {
    throw new Error("--approved must contain a signed approved dataset");
  }
  if (template.status !== "needs_review" || template.approval !== null) {
    throw new Error("--config-template must be an unsigned needs_review dataset");
  }
  if (approved.clinic.clinicKey !== template.clinic.clinicKey) {
    throw new Error("Clinic keys do not match");
  }

  const beforeDigest = conversationContentDigest(approved.scenarios);
  const scenarios = approved.scenarios.map((scenario) => ({
    ...scenario,
    datasetVersion: template.datasetVersion,
    clinic: {
      clinicKey: template.clinic.clinicKey,
      configFingerprint: template.clinic.configFingerprint,
      playbookFingerprint: template.clinic.playbookFingerprint,
    },
  }));
  const afterDigest = conversationContentDigest(scenarios);
  if (beforeDigest !== afterDigest) {
    throw new Error("Conversation content changed while rebinding configuration");
  }

  const rebound: ReplayDatasetV2 = {
    ...approved,
    datasetVersion: template.datasetVersion,
    generatedAt: template.generatedAt,
    status: "needs_review",
    sanitization: {
      automated: true,
      humanReviewRequired: true,
      humanReviewApprovedAt: null,
    },
    approval: null,
    clinic: template.clinic,
    scenarioCount: scenarios.length,
    scenarios,
  };
  await writeFile(outputPath, `${JSON.stringify(rebound, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    outputPath,
    clinicKey: rebound.clinic.clinicKey,
    scenarioCount: rebound.scenarioCount,
    conversationContentDigest: afterDigest,
    conversationContentPreserved: true,
    status: rebound.status,
  }));
}

function conversationContentDigest(scenarios: ReplayScenarioV1[]): string {
  return createHash("sha256")
    .update(JSON.stringify(
      scenarios.map((scenario) => ({
        source: scenario.source,
        compatibleModes: scenario.compatibleModes,
        clock: scenario.clock,
        tags: scenario.tags,
        turns: scenario.turns,
      })),
    ))
    .digest("hex");
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
