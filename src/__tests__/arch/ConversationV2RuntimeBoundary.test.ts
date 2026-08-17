import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

describe("Cycle I final runtime boundaries", () => {
  it("mantém o core V2 sem V1, Domain Pack, provider, DB, calendário, config ou comparação", () => {
    const forbidden = /(?:^|\/)(?:core|domain-packs|infrastructure|providers|repositories)(?:\/|$)|application\/conversation-v2|application\/config|(?:^|\/)comparison(?:\/|$)|^(?:openai|@anthropic-ai\/sdk|drizzle-orm|postgres)(?:\/|$)|calendar/i;
    const offenders = sourceFiles("src/conversation-core").flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => specifier === "<dynamic-nonliteral>" || forbidden.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("mantém o Dental Pack declarativo e independente de OpenAI/provider", () => {
    const provider = /^(?:openai|@anthropic-ai\/sdk|@google\/generative-ai)(?:\/|$)|(?:^|\/)(?:providers|infrastructure|application)(?:\/|$)/;
    const offenders = sourceFiles("src/domain-packs/dental").flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => specifier === "<dynamic-nonliteral>" || provider.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

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
    const offenders = runnerFiles.flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => specifier === "<dynamic-nonliteral>" || forbidden.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

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
