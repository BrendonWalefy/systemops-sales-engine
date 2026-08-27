import { describe, expect, it } from "vitest";
import {
  openAiEvidence,
  sealAiEvidence,
  type AiEvidenceAad,
} from "@/infrastructure/crypto/ai-evidence-vault";

const KEY = "5a".repeat(32);
const RAW = "modelo devolveu um valor privado rejeitado";
const aad: AiEvidenceAad = {
  version: "ai-evidence-aad.v1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  rejectionId: "22222222-2222-4222-8222-222222222222",
  turnId: "33333333-3333-4333-8333-333333333333",
  stage: "understanding_semantic",
};

describe("AI evidence vault", () => {
  it("round-trips rejected output without plaintext in the envelope", () => {
    const envelope = sealAiEvidence(RAW, aad, KEY);

    expect(envelope).toMatch(/^aiev:v1:/);
    expect(envelope).not.toContain(RAW);
    expect(openAiEvidence(envelope, aad, KEY)).toBe(RAW);
  });

  it("uses a fresh IV for every sealed evidence", () => {
    const first = sealAiEvidence(RAW, aad, KEY);
    const second = sealAiEvidence(RAW, aad, KEY);

    expect(first).not.toBe(second);
    expect(openAiEvidence(first, aad, KEY)).toBe(RAW);
    expect(openAiEvidence(second, aad, KEY)).toBe(RAW);
  });

  it.each([
    ["organizationId", "44444444-4444-4444-8444-444444444444"],
    ["rejectionId", "44444444-4444-4444-8444-444444444444"],
    ["turnId", "44444444-4444-4444-8444-444444444444"],
    ["stage", "response_verbalization"],
  ] as const)("rejects ciphertext moved to another %s", (field, value) => {
    const envelope = sealAiEvidence(RAW, aad, KEY);

    expect(() => openAiEvidence(envelope, { ...aad, [field]: value }, KEY))
      .toThrow("AI evidence decryption failed");
  });

  it("rejects malformed envelopes without cryptographic detail", () => {
    expect(() => openAiEvidence("aiev:v1:bad", aad, KEY))
      .toThrow("AI evidence decryption failed");
  });

  it.each([undefined, "", "not-hex", "aa"])(
    "fails closed for a missing or invalid dedicated key",
    (key) => {
      expect(() => sealAiEvidence(RAW, aad, key)).toThrow(
        "AI_EVIDENCE_ENCRYPTION_KEY must be 64 hex characters",
      );
    },
  );

  it("seals 64 KiB within the approved local crypto budget", () => {
    const sample = "x".repeat(65_536);
    const durations: number[] = [];

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const startedAt = performance.now();
      sealAiEvidence(sample, aad, KEY);
      durations.push(performance.now() - startedAt);
    }

    durations.sort((left, right) => left - right);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThanOrEqual(5);
  });
});
