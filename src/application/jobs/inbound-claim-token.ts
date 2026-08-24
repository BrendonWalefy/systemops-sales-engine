import { createHash, randomBytes } from "node:crypto";

export function generateInboundClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestInboundClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}
