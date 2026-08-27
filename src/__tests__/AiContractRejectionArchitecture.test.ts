import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAiEvidenceCaptureEnabled } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AI contract rejection evidence architecture", () => {
  it("uses an explicit fail-closed capture rollback switch", () => {
    expect(isAiEvidenceCaptureEnabled({})).toBe(true);
    expect(isAiEvidenceCaptureEnabled({ AI_EVIDENCE_CAPTURE_ENABLED: "true" })).toBe(true);
    expect(isAiEvidenceCaptureEnabled({ AI_EVIDENCE_CAPTURE_ENABLED: "false" })).toBe(false);
    expect(isAiEvidenceCaptureEnabled({ AI_EVIDENCE_CAPTURE_ENABLED: "" })).toBe(false);
    expect(isAiEvidenceCaptureEnabled({ AI_EVIDENCE_CAPTURE_ENABLED: "typo" })).toBe(false);
  });

  it("introduces no logger, Sentry, model call, polling, heartbeat or worker", () => {
    const evidenceSources = [
      "src/application/observability/reveal-ai-contract-rejection.ts",
      "src/infrastructure/crypto/ai-evidence-vault.ts",
      "src/infrastructure/observability/runtime-ai-contract-rejection-recorder.ts",
      "src/infrastructure/repositories/drizzle-ai-contract-rejection-store.ts",
    ].map(read).join("\n");

    expect(evidenceSources).not.toMatch(/createLogger|console\.|Sentry|captureException/);
    expect(evidenceSources).not.toMatch(/OpenAI|chat\.completions|responses\.create/);
    expect(evidenceSources).not.toMatch(/setInterval|heartbeat|polling|new Worker/);
    expect(read("src/app/api/cron/decision-trace-cleanup/route.ts"))
      .toContain("aiContractRejectionRawExpired");
  });

  it("keeps raw fields out of outcomes and Decision Trace contracts", () => {
    expect(read("src/conversation-core/composer/verbalization.ts"))
      .not.toMatch(/VerbalizationOutcome[\s\S]{0,1000}rawOutput/);
    const trace = read("src/core/observability/DecisionTrace.ts");
    expect(trace).not.toContain('"rawOutput"');
    expect(trace).not.toContain('"rejectedText"');
    expect(trace).not.toContain('"encryptedOutput"');
  });

  it("uses a dedicated key and documents migration, retention and rollback", () => {
    const env = read(".env.example");
    expect(env).toContain('AI_EVIDENCE_ENCRYPTION_KEY=""');
    expect(env).toContain('AI_EVIDENCE_CAPTURE_ENABLED="true"');
    expect(env).not.toMatch(/AI_EVIDENCE_ENCRYPTION_KEY=.*CREDENTIAL_ENCRYPTION_KEY/);

    const runbook = read("docs/operations/ai-contract-rejection-evidence.md");
    for (const required of [
      "0104",
      "0105",
      "7 dias",
      "30 dias",
      "sem backfill",
      "AI_EVIDENCE_CAPTURE_ENABLED=false",
      "não altera authority V2",
    ]) {
      expect(runbook).toContain(required);
    }
    expect(read("docs/architecture/current.md"))
      .toContain("ai-contract-rejection-evidence.md");
  });
});
