import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSanitizedReplayCorpus } from "@/application/replay/build-sanitized-replay-corpus";
import {
  approveReplayDataset,
  verifyReplayDatasetApproval,
} from "@/application/replay/replay-dataset-approval";

function dataset() {
  return buildSanitizedReplayCorpus({
    datasetVersion: "baseline-1",
    generatedAt: new Date("2026-07-24T12:00:00.000Z"),
    clinicKey: "clinic-a",
    timezone: "America/Sao_Paulo",
    configFingerprint: "config",
    playbookFingerprint: "playbook",
    sourceHashKey: "test-key-with-at-least-thirty-two-characters",
    conversations: [],
  });
}

describe("replay dataset approval", () => {
  it("assina e valida um dataset revisado com Ed25519", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const approved = approveReplayDataset({
      dataset: dataset(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
      approvedAt: new Date("2026-07-24T18:00:00.000Z"),
      approvedBy: "qa-owner",
    });

    expect(approved.status).toBe("approved");
    expect(approved.sanitization.humanReviewApprovedAt)
      .toBe("2026-07-24T18:00:00.000Z");
    expect(() =>
      verifyReplayDatasetApproval(
        approved,
        publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).not.toThrow();
  });

  it("recusa qualquer alteração depois da assinatura", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const approved = approveReplayDataset({
      dataset: dataset(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
      approvedAt: new Date("2026-07-24T18:00:00.000Z"),
      approvedBy: "qa-owner",
    });
    approved.clinic.configFingerprint = "edited";

    expect(() =>
      verifyReplayDatasetApproval(
        approved,
        publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).toThrow("signature is invalid");
  });

  it("recusa chave pública não confiável e dataset não revisado", () => {
    const trusted = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const approved = approveReplayDataset({
      dataset: dataset(),
      privateKeyPem: trusted.privateKey.export({ type: "pkcs8", format: "pem" }),
      approvedAt: new Date("2026-07-24T18:00:00.000Z"),
      approvedBy: "qa-owner",
    });

    expect(() =>
      verifyReplayDatasetApproval(
        approved,
        other.publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).toThrow("does not match");
    expect(() =>
      verifyReplayDatasetApproval(
        dataset(),
        trusted.publicKey.export({ type: "spki", format: "pem" }),
      ),
    ).toThrow("not cryptographically approved");
  });
});
