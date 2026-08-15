import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CORPUS_RESIDUAL_PII_DETECTORS } from "@/application/corpus/redact-corpus-text";

/**
 * Auditoria de PII sobre tudo que será publicado.
 *
 * Varrer a working tree não basta: o que vai para o remoto são **commits**, e um
 * blob removido do último commit continua alcançável pelos anteriores. Este
 * script varre os dois — os arquivos de hoje e todo blob introduzido pelos
 * commits que a branch tem a mais que a base.
 *
 * Só leitura. Não escreve no repositório nem no banco.
 */

type Finding = {
  where: string;
  kind: string;
  sample: string;
};

const DETECTORS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: "telefone", pattern: /(?:\+\s?55\s?)?(?:\(\s?\d{2}\s?\)|\b\d{2})\s?9?\s?\d{4}[\s-]?\d{4}\b/g },
  { kind: "telefone-fixo", pattern: /\b\d{4}-\d{4}\b/g },
  { kind: "cpf", pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { kind: "cnpj", pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g },
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "cep", pattern: /\b\d{5}-\d{3}\b/g },
  { kind: "url-com-esquema", pattern: /https?:\/\/[^\s)"'<>\\]+/gi },
  {
    kind: "url-sem-esquema",
    pattern: /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|io|app|me|gov)(?:\.[a-z]{2})?\//gi,
  },
  { kind: "uuid", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
  {
    kind: "arquivo-anexado",
    pattern: /[\p{L}\p{N}_-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|jpe?g|png|heic|mp4|mp3|ogg|opus|zip)\b/giu,
  },
  { kind: "payload-longo", pattern: /\b\d{20,}/g },
  // Primeiro nome em vocativo. Vem da barreira, não de uma cópia: foi
  // justamente um detector que não existia aqui que deixou "Olá <Nome>" chegar
  // a uma folha entregue a terceiro.
  { kind: "nome-apos-saudacao", pattern: CORPUS_RESIDUAL_PII_DETECTORS.greetingVocative! },
  {
    kind: "endereco",
    pattern: /\b(?:rua|avenida|av\.|alameda|travessa|rodovia|estrada)\s+\p{Lu}/giu,
  },
];

/**
 * Termos de identidade de tenant. Não existe regra geral que separe um nome
 * comercial de um substantivo comum, então a lista é explícita e vem de fora do
 * repositório — colocá-la aqui gravaria no Git exatamente o que ela remove.
 */
function identityTerms(): string[] {
  return (process.env.CORPUS_AUDIT_IDENTITIES ?? process.env.CORPUS_REDACT_PLACES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Achados aceitos, com o motivo. Cada entrada é uma decisão registrada, não um
 * silenciamento: quem revisar o PR vê o que foi dispensado e por quê.
 */
const ACCEPTED: ReadonlyArray<{
  file: RegExp;
  kind: string;
  sample: RegExp;
  reason: string;
}> = [
  {
    file: /docs\/ai-system\/v1-freeze\.md$/,
    kind: "url-com-esquema",
    sample: /github\.com\/BrendonWalefy\/systemops-sales-engine/,
    reason: "link para PR do próprio repositório, público e sem dado de terceiro",
  },
  {
    file: /docs\/ai-system\/v1-freeze\.md$/,
    kind: "url-sem-esquema",
    sample: /github\.com\//,
    reason: "mesmo link acima, capturado pelo detector sem esquema",
  },
  {
    file: /evals\/corpus\/cases\/other\.jsonl$/,
    kind: "endereco",
    sample: /Rua E/,
    reason: "\"Rua Exemplo, 100\" — endereço inventado num caso sintético de regressão",
  },
];

function isAccepted(finding: Finding): string | null {
  const file = finding.where.replace(/^(worktree|blob):(?:[0-9a-f]+:)?/, "");
  for (const rule of ACCEPTED) {
    if (
      rule.kind === finding.kind &&
      rule.file.test(file) &&
      rule.sample.test(finding.sample)
    ) {
      return rule.reason;
    }
  }
  return null;
}

function scan(where: string, content: string, terms: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0;
    const matches = content.match(detector.pattern);
    if (matches?.length) {
      findings.push({
        where,
        kind: detector.kind,
        sample: matches.slice(0, 3).join(" | ").slice(0, 160),
      });
    }
  }
  const folded = content.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  for (const term of terms) {
    const needle = term.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (needle && folded.includes(needle)) {
      findings.push({ where, kind: "identidade-de-tenant", sample: term });
    }
  }
  return findings;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function main(): void {
  const argv = process.argv.slice(2);

  // `--file` audita um artefato solto — tipicamente uma folha de revisão que
  // vive fora do repositório e vai para um terceiro. Mesmos detectores, mesma
  // deny-list; auditar isso com um script paralelo seria auditar outra coisa.
  const singleFile = value(argv, "--file");
  if (singleFile) {
    const terms = identityTerms();
    const findings = scan(`file:${singleFile}`, readFileSync(singleFile, "utf8"), terms);
    const blocking = findings.filter((finding) => isAccepted(finding) === null);
    console.log(
      JSON.stringify(
        {
          file: singleFile,
          identityTermsConfigured: terms.length,
          findings,
          verdict: blocking.length === 0 ? "clean" : "PII FOUND — do not share",
        },
        null,
        2,
      ),
    );
    if (blocking.length > 0) process.exitCode = 1;
    return;
  }

  const base = value(argv, "--base") ?? "origin/main";
  const paths = (value(argv, "--paths") ?? "evals/corpus,docs/ai-system").split(",");
  const terms = identityTerms();

  const findings: Finding[] = [];

  // 1. Arquivos de hoje, nos caminhos publicáveis.
  const tracked = git(["ls-files", ...paths]).split("\n").filter(Boolean);
  for (const file of tracked) {
    findings.push(...scan(`worktree:${file}`, readFileSync(file, "utf8"), terms));
  }

  // 2. Todo blob introduzido pelos commits que a branch tem a mais que a base.
  //    É isto que vai para o remoto, e é o que `git grep` na working tree não vê.
  const commits = git(["rev-list", `${base}..HEAD`]).split("\n").filter(Boolean);
  const seen = new Set<string>();
  let blobCount = 0;
  for (const commit of commits) {
    const entries = git(["ls-tree", "-r", commit, "--", ...paths])
      .split("\n")
      .filter(Boolean);
    for (const entry of entries) {
      const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
      if (!match) continue;
      const [, sha, path] = match as unknown as [string, string, string];
      if (seen.has(sha)) continue;
      seen.add(sha);
      blobCount += 1;
      findings.push(
        ...scan(`blob:${sha.slice(0, 8)}:${path}`, git(["cat-file", "-p", sha]), terms),
      );
    }
  }

  const accepted = findings
    .map((finding) => ({ finding, reason: isAccepted(finding) }))
    .filter((entry): entry is { finding: Finding; reason: string } =>
      entry.reason !== null,
    );
  const blocking = findings.filter((finding) => isAccepted(finding) === null);

  const report = {
    base,
    paths,
    identityTermsConfigured: terms.length,
    filesScanned: tracked.length,
    commitsScanned: commits.length,
    distinctBlobsScanned: blobCount,
    acceptedFindings: accepted.map((entry) => ({
      ...entry.finding,
      acceptedBecause: entry.reason,
    })),
    blockingFindings: blocking,
    verdict: blocking.length === 0 ? "clean" : "PII FOUND — do not publish",
  };
  console.log(JSON.stringify(report, null, 2));
  if (blocking.length > 0) process.exitCode = 1;
}

function value(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

main();
