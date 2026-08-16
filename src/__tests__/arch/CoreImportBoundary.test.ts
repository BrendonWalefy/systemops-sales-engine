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
      /(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["'`]([^"'`]+)["'`]/g,
    ),
  ].map((match) => match[1]!);

  const violations = specifiers.filter((specifier) =>
    specifier === "openai" || specifier.startsWith("openai/")
    || specifier === "@anthropic-ai/sdk" || specifier.startsWith("@anthropic-ai/sdk/")
    || /(?:^|\/)(?:domain-packs|infrastructure|providers)(?:\/|$)/.test(specifier)
    || /(?:^|\/)application\/config(?:\/|$)/.test(specifier),
  );
  if (/import\s*\(\s*[^"'`\s]/.test(source)) violations.push("nonliteral dynamic import");
  return violations;
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
      'import(`@/infrastructure/db/client`)',
      'import(providerPath)',
      'import helper from "openai/helpers/zod"',
    ];

    expect(bypassAttempts.map(violationsIn).map((items) => items.length))
      .toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("mantém composer e renderer H sem chamadas a provider, modelo, rede ou I/O", () => {
    const forbiddenCall = /\b(?:fetch|XMLHttpRequest|WebSocket|OpenAI|Anthropic|generateContent)\b|\b(?:chat\.completions|responses\.create|process\.env)\b/;
    const offenders = sourceFiles("src/conversation-core/composer")
      .filter((file) => forbiddenCall.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
