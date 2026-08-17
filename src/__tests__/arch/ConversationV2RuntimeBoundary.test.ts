import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const add = (node: ts.Expression | undefined): void => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      imports.push(node.text);
    } else {
      imports.push("<dynamic-nonliteral>");
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier);
    else if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

function resolveLocalModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function transitiveLocalFiles(entries: readonly string[]): readonly string[] {
  const pending = [...entries];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of moduleSpecifiers(file)) {
      const dependency = resolveLocalModule(file, specifier);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited];
}

const forbiddenRuntimePackages = /^(?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@ai-sdk\/|@neondatabase\/serverless|drizzle-orm|postgres)(?:\/|$)/;
const forbiddenCapabilitySymbols = /\b(?:OpenAI|Anthropic|GoogleGenerativeAI|neon|drizzle|BookingService|DATABASE_URL|calendarId)\b/;

function forbiddenRuntimeReferences(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const references = moduleSpecifiers(file)
      .filter((specifier) => specifier === "<dynamic-nonliteral>" || forbiddenRuntimePackages.test(specifier))
      .map((specifier) => `${file} -> ${specifier}`);
    if (forbiddenCapabilitySymbols.test(source)) references.push(`${file} -> forbidden capability symbol`);
    return references;
  });
}

describe("Cycle I final runtime boundaries", () => {
  it("mantém o core V2 sem V1, Domain Pack, provider, DB, calendário, config ou comparação", () => {
    const roots = sourceFiles("src/conversation-core");
    const forbiddenPath = /(?:^|\/)(?:src\/core|src\/domain-packs|src\/infrastructure|src\/application\/conversation-v2|src\/application\/config)(?:\/|$)|calendar|comparison/i;
    const graph = transitiveLocalFiles(roots);
    const offenders = graph.filter((file) => !roots.includes(file) && forbiddenPath.test(file));
    offenders.push(...forbiddenRuntimeReferences(graph));

    expect(offenders).toEqual([]);
  });

  it("mantém o Dental Pack declarativo e independente de OpenAI/provider", () => {
    const provider = /(?:^|\/)(?:providers|infrastructure|application)(?:\/|$)/;
    const roots = sourceFiles("src/domain-packs/dental");
    const graph = transitiveLocalFiles(roots);
    const offenders = graph
      .filter((file) => !roots.includes(file) && /src\/(?:infrastructure|application)\//.test(file));
    offenders.push(...graph.flatMap((file) => moduleSpecifiers(file)
      .filter((specifier) => provider.test(specifier))
      .map((specifier) => `${file} -> ${specifier}`)));
    offenders.push(...forbiddenRuntimeReferences(graph));

    expect(offenders).toEqual([]);
  });

  it("mantém o runner offline sem DB, repository, booking, calendário, outbox ou canal", () => {
    const runnerFiles = [
      "scripts/eval-conversation-v2-cycle-i-bootstrap.ts",
      "scripts/eval-conversation-v2-cycle-i.ts",
      "src/application/conversation-v2/corpus-comparison-runner.ts",
      "src/application/conversation-v2/decision-fixture-manifest.ts",
      "src/application/conversation-v2/productive-understanding-arms.ts",
    ];
    const forbidden = /(?:^|\/)(?:db|repositories|calendar|channels)(?:\/|$)|BookingService|outbox/i;
    const graph = transitiveLocalFiles(runnerFiles);
    const offenders = graph.filter((file) => forbidden.test(file));
    offenders.push(...graph.flatMap((file) => moduleSpecifiers(file)
      .filter((specifier) => specifier === "<dynamic-nonliteral>" || forbidden.test(specifier))
      .map((specifier) => `${file} -> ${specifier}`)));

    expect(offenders).toEqual([]);
  });

  it("mantém a route como composition root fino, sem regra V2 ou domínio dental", () => {
    const source = readFileSync("src/app/api/cron/message-worker/route.ts", "utf8");

    expect(source).toContain("createConversationV2Runtime");
    expect(source).toContain("runAfterSenderDrainAttempt");
    expect(source).toContain("runConversationV2ShadowBatch");
    expect(source).not.toMatch(/resolveConversationEngine|V2ShadowRunner|createDentalPack|DentalUnderstanding|bookSlot|confirmAppointment|v2_internal/);
    expect(source).not.toContain("shadowModeEnabled");
    expect(source.match(/export async function GET/g)).toHaveLength(1);
  });
});
