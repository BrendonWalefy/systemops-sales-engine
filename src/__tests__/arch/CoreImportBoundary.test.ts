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

const FORBIDDEN_FROM_CORE = [
  /from\s+["']@\/domain-packs(?:\/|["'])/,
  /from\s+["']@\/application\/config(?:\/|["'])/,
  /from\s+["'](?:openai|@anthropic-ai\/sdk)["']/,
  /from\s+["']@\/infrastructure(?:\/|["'])/,
];

describe("fronteira de importação do core V2", () => {
  it("não importa packs, configuração de tenant, providers ou infraestrutura", () => {
    const offenders = sourceFiles("src/conversation-core").flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORBIDDEN_FROM_CORE
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file} -> ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
