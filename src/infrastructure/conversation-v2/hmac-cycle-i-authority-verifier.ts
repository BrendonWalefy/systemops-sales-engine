import { createHmac, timingSafeEqual } from "node:crypto";
import type { CycleIAuthorityVerifier } from "@/application/ports/cycle-i-authority-verifier";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

function expectedDigest(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

function verify(payload: string, digest: HmacRef, key: string): boolean {
  const received = Buffer.from(digest.slice("hmac:".length), "hex");
  const expected = expectedDigest(payload, key);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export class HmacCycleIAuthorityVerifier implements CycleIAuthorityVerifier {
  private readonly key: string;

  constructor(key: string) {
    if (typeof key !== "string" || key.length < 32 || key.length > 4_096) {
      throw new Error("invalid Cycle I authority HMAC key");
    }
    this.key = key;
  }

  verifyGateReport(payload: string, digest: HmacRef): boolean {
    return verify(payload, digest, this.key);
  }

  verifyApprovalRecord(payload: string, signature: HmacRef): boolean {
    return verify(payload, signature, this.key);
  }
}
