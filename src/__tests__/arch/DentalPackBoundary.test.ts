import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("fronteira do Dental Domain Pack", () => {
  it("depende só de contratos genéricos e código do próprio pack", () => {
    const offenders = files("src/domain-packs/dental").flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
      return imports
        .filter((specifier) => /(?:^|\/)(?:application|infrastructure|providers|core)(?:\/|$)/.test(specifier)
          && !specifier.includes("conversation-core"))
        .map((specifier) => `${file} -> ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });

  it("não abre canais de I/O dentro do pack", () => {
    const forbidden = /\b(?:fetch|process\.env|readFile|writeFile|createAppointment)\b/;
    expect(files("src/domain-packs/dental").filter((file) => forbidden.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});
