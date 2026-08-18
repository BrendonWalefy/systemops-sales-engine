import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? files(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function importedSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  const addModuleSpecifier = (node: ts.Expression | undefined): void => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      specifiers.push(node.text);
      return;
    }
    specifiers.push("<dynamic-nonliteral>");
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      addModuleSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

describe("fronteira do Dental Domain Pack", () => {
  it("depende só de contratos genéricos e código do próprio pack", () => {
    const offenders = files("src/domain-packs/dental").flatMap((file) => {
      return importedSpecifiers(file)
        .filter(
          (specifier) =>
            specifier === "<dynamic-nonliteral>" ||
            (/(?:^|\/)(?:application|infrastructure|providers|core)(?:\/|$)/.test(
              specifier,
            ) &&
              !specifier.includes("conversation-core")),
        )
        .map((specifier) => `${file} -> ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });

  it("declara o domínio sem importar SDK de modelo ou provider", () => {
    const providerPackage =
      /^(?:openai|@anthropic-ai\/sdk|@google\/generative-ai)(?:\/|$)/;
    const offenders = files("src/domain-packs/dental").flatMap((file) => {
      return importedSpecifiers(file)
        .filter((specifier) => providerPackage.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });

  it("não abre canais de I/O dentro do pack", () => {
    const forbidden =
      /\b(?:fetch|process\.env|readFile|writeFile|createAppointment)\b/;
    expect(
      files("src/domain-packs/dental").filter((file) =>
        forbidden.test(readFileSync(file, "utf8")),
      ),
    ).toEqual([]);
  });
});
