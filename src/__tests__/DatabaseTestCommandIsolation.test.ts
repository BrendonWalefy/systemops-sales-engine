import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const authoritySuite = [
  "src/__tests__/ScheduledBurstDebounceDatabase.test.ts",
  "src/__tests__/WhatsAppAuthorityBackfillDatabase.test.ts",
  "src/__tests__/WhatsAppTerminalLegacySettlementDatabase.test.ts",
  "src/__tests__/WhatsAppStreamPerformance.test.ts",
  "src/__tests__/helpers/embedded-authority-database.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");

describe("database test command isolation", () => {
  it("runs calendar and embedded authority suites in separate processes", () => {
    expect(packageJson.scripts["test:db:calendar"]).toBe(
      "dotenv -e .env.test.local -- vitest run src/__tests__/calendar-import.test.ts",
    );
    expect(packageJson.scripts["test:db:authority"]).toBe(
      "vitest run src/__tests__/ScheduledBurstDebounceDatabase.test.ts src/__tests__/WhatsAppAuthorityBackfillDatabase.test.ts src/__tests__/WhatsAppTerminalLegacySettlementDatabase.test.ts src/__tests__/WhatsAppStreamPerformance.test.ts --maxWorkers=1",
    );
    expect(packageJson.scripts["test:db:schema"]).toBe(
      "vitest run src/__tests__/WhatsAppStreamSchema.test.ts",
    );
    expect(packageJson.scripts["test:db"]).toBe(
      "npm run test:db:authority",
    );
    expect(packageJson.scripts["test:db:all"]).toBeUndefined();
    expect(packageJson.scripts.test).toContain(
      "--exclude src/__tests__/ScheduledBurstDebounceDatabase.test.ts",
    );
    expect(packageJson.scripts.test).toContain(
      "--exclude src/__tests__/WhatsAppAuthorityBackfillDatabase.test.ts",
    );
    expect(packageJson.scripts.test).toContain(
      "--exclude src/__tests__/WhatsAppTerminalLegacySettlementDatabase.test.ts",
    );
    expect(packageJson.scripts.test).toContain(
      "--exclude src/__tests__/WhatsAppStreamPerformance.test.ts",
    );
    expect(packageJson.scripts.test).toContain(
      "--exclude src/__tests__/WhatsAppStreamSchema.test.ts",
    );
  });

  it("runs the embedded authority suite explicitly in CI with no skip gate", () => {
    const configuredDatabaseUrl = ciWorkflow.match(/DATABASE_URL:\s*(\S+)/)?.[1];
    expect(configuredDatabaseUrl).toBeDefined();
    const parsedDatabaseUrl = new URL(configuredDatabaseUrl!);

    expect(ciWorkflow).toContain("run: npm run test:db:authority");
    expect(parsedDatabaseUrl.hostname).toBe("127.0.0.1");
    expect(ciWorkflow).toContain("TEST_DATABASE_HOST: 127.0.0.1");
    expect(ciWorkflow).toContain("PRODUCTION_DATABASE_HOST: production.invalid");
    expect(authoritySuite).not.toContain("describe.skipIf");
    expect(authoritySuite).toContain("resolveTestDatabaseAccess");
    expect(authoritySuite).toContain("reserveAvailablePort");
  });
});
