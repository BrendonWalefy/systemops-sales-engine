import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { AiContractRejectionStage } from "@/application/ports/ai-contract-rejection-recorder";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_PREFIX = "aiev:v1:";

export type AiEvidenceAad = Readonly<{
  version: "ai-evidence-aad.v1";
  organizationId: string;
  rejectionId: string;
  turnId: string;
  stage: AiContractRejectionStage;
}>;

function keyFromHex(explicitKey?: string): Buffer {
  const keyHex = explicitKey ?? process.env.AI_EVIDENCE_ENCRYPTION_KEY;
  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error(
      "AI_EVIDENCE_ENCRYPTION_KEY must be 64 hex characters",
    );
  }
  return Buffer.from(keyHex, "hex");
}

function encodeAad(aad: AiEvidenceAad): Buffer {
  return Buffer.from(JSON.stringify([
    aad.version,
    aad.organizationId,
    aad.rejectionId,
    aad.turnId,
    aad.stage,
  ]), "utf8");
}

export function sealAiEvidence(
  rawOutput: string,
  aad: AiEvidenceAad,
  explicitKey?: string,
): string {
  const key = keyFromHex(explicitKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(encodeAad(aad));
  const encrypted = Buffer.concat([
    cipher.update(rawOutput, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function openAiEvidence(
  envelope: string,
  aad: AiEvidenceAad,
  explicitKey?: string,
): string {
  const key = keyFromHex(explicitKey);
  try {
    if (!envelope.startsWith(ENVELOPE_PREFIX)) throw new Error("format");
    const [ivHex, tagHex, ciphertextHex, extra] = envelope
      .slice(ENVELOPE_PREFIX.length)
      .split(":");
    if (
      extra !== undefined
      || !ivHex
      || !tagHex
      || ciphertextHex === undefined
      || !/^[a-f0-9]{24}$/i.test(ivHex)
      || !/^[a-f0-9]{32}$/i.test(tagHex)
      || !/^(?:[a-f0-9]{2})*$/i.test(ciphertextHex)
    ) {
      throw new Error("format");
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAAD(encodeAad(aad));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("AI evidence decryption failed");
  }
}
