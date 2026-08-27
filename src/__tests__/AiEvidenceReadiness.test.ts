import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateAiEvidenceReadiness } from "@/infrastructure/crypto/ai-evidence-readiness";

describe("AI evidence deployment readiness", () => {
  it("blocks production capture without one valid dedicated key", () => {
    expect(evaluateAiEvidenceReadiness({})).toEqual({
      ready: false,
      status: "blocked",
      reason: "ai_evidence_encryption_key_invalid",
    });
    expect(evaluateAiEvidenceReadiness({
      AI_EVIDENCE_CAPTURE_ENABLED: "true",
      AI_EVIDENCE_ENCRYPTION_KEY: "not-a-key",
    })).toEqual({
      ready: false,
      status: "blocked",
      reason: "ai_evidence_encryption_key_invalid",
    });
  });

  it("accepts a valid key or an explicit capture rollback without exposing values", () => {
    const key = "9f".repeat(32);
    const ready = evaluateAiEvidenceReadiness({
      AI_EVIDENCE_CAPTURE_ENABLED: "true",
      AI_EVIDENCE_ENCRYPTION_KEY: key,
    });
    const disabled = evaluateAiEvidenceReadiness({
      AI_EVIDENCE_CAPTURE_ENABLED: "false",
      AI_EVIDENCE_ENCRYPTION_KEY: key,
    });

    expect(ready).toEqual({ ready: true, status: "ready" });
    expect(disabled).toEqual({ ready: true, status: "disabled" });
    expect(JSON.stringify([ready, disabled])).not.toContain(key);
  });

  it("blocks an ambiguous capture flag", () => {
    expect(evaluateAiEvidenceReadiness({
      AI_EVIDENCE_CAPTURE_ENABLED: "typo",
      AI_EVIDENCE_ENCRYPTION_KEY: "9f".repeat(32),
    })).toEqual({
      ready: false,
      status: "blocked",
      reason: "ai_evidence_capture_flag_invalid",
    });
  });

  it("enforces readiness only at the production deployment boundary", () => {
    const source = readFileSync("scripts/vercel-build.ts", "utf8");
    expect(source).toContain("evaluateAiEvidenceReadiness");
    expect(source).toContain('vercelEnv === "production"');
    expect(source).not.toContain("AI_EVIDENCE_ENCRYPTION_KEY must be");
  });
});
