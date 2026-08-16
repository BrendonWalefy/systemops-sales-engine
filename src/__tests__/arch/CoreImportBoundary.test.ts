import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

function violationsIn(source: string): string[] {
  const specifiers = [
    ...source.matchAll(
      /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]!);

  return specifiers.filter((specifier) =>
    specifier === "openai"
    || specifier === "@anthropic-ai/sdk"
    || /(?:^|\/)(?:domain-packs|infrastructure|providers)(?:\/|$)/.test(specifier)
    || /(?:^|\/)application\/config(?:\/|$)/.test(specifier),
  );
}

describe("fronteira de importação do core V2", () => {
  it("não importa packs, configuração de tenant, providers ou infraestrutura", () => {
    const offenders = sourceFiles("src/conversation-core").flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return violationsIn(source).map((violation) => `${file} -> ${violation}`);
    });

    expect(offenders).toEqual([]);
  });

  it("detecta imports estáticos, dinâmicos, require e caminhos relativos", () => {
    const bypassAttempts = [
      'import("@/infrastructure/db/client")',
      'require("../../domain-packs/fixture")',
      'export { adapter } from "../providers/adapter"',
      'import OpenAI from "openai"',
    ];

    expect(bypassAttempts.map(violationsIn).map((items) => items.length)).toEqual([1, 1, 1, 1]);
  });
});
