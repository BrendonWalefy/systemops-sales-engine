import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("V2 shadow write boundary", () => {
  it("mantém o runner e adapters sem dependências de produção que escrevem", async () => {
    const files = await Promise.all([
      readFile("src/application/conversation-v2/v2-shadow-runner.ts", "utf8"),
      readFile("src/application/conversation-v2/dental-captured-read-adapters.ts", "utf8"),
    ]);
    for (const source of files) {
      expect(source).not.toMatch(/BookingService|calendar|outbox|channel|infrastructure\/db/i);
    }
  });
});
