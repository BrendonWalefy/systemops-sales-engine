import { createHmac } from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-in-prod";
const COOKIE_NAME = "sops_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function signToken(email: string): string {
  const payload = `${email}:${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
    return sig === expected;
  } catch {
    return false;
  }
}

export { COOKIE_NAME, MAX_AGE };
