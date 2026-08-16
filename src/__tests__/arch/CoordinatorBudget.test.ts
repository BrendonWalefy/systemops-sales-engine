import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COORDINATOR = "src/conversation-core/capability/coordinator.ts";
const CONCRETE_OR_EXTERNAL_IMPORT = /from\s+["']@\/(?:domain-packs|infrastructure|application)(?:\/|["'])/;

describe("orçamento do CapabilityCoordinator", () => {
  it("permanece em até 150 linhas", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(150);
  });

  it("não conhece capabilities concretas nem portas externas", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    expect(source).not.toMatch(CONCRETE_OR_EXTERNAL_IMPORT);
  });
});
