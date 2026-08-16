import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import forbiddenTerms from "./domain-lexicon.json";

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

function normalize(source: string): string {
  return source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

describe("léxico do core V2", () => {
  it("não contém vocabulário de um vertical real", () => {
    const offenders = sourceFiles("src/conversation-core").flatMap((file) => {
      const source = normalize(readFileSync(file, "utf8"));
      return forbiddenTerms
        .filter((term) => new RegExp(`\\b${term}\\w*`, "i").test(source))
        .map((term) => `${file} -> ${term}`);
    });

    expect(offenders).toEqual([]);
  });
});
