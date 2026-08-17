import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

describe("TenantEngineRouter architectural boundary", () => {
  it("keeps engine policy reads and runtime branching inside the router boundary", () => {
    const allowed = new Set([
      "src/application/conversation-v2/engine-selection.ts",
      "src/application/conversation-v2/tenant-engine-router.ts",
      "src/application/ports/conversation-engine-policy-reader.ts",
      "src/infrastructure/db/schema.ts",
      "src/infrastructure/repositories/drizzle-conversation-engine-policy-reader.ts",
    ]);
    const offenders = sourceFiles("src")
      .map((path) => ({ path: relative(".", path), source: readFileSync(path, "utf8") }))
      .filter(({ path, source }) => !allowed.has(path)
        && /\b(?:conversationEngine|getConversationEnginePolicy|resolveConversationEngine)\b/.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("keeps the Internal Lab approval rule behind one canonical application import", () => {
    const directApprovalConsumers = sourceFiles("src/application")
      .map((path) => ({ path: relative(".", path), source: readFileSync(path, "utf8") }))
      .filter(({ source }) => /from\s+["']@\/application\/conversation-v2\/internal-lab-approval["']/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(directApprovalConsumers).toEqual([
      "src/application/conversation-v2/internal-lab-authorization.ts",
    ]);
  });
});
