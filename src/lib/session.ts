const COOKIE_NAME = "sops_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const enc = new TextEncoder();

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET ?? "dev-secret-change-in-prod";
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type SessionRole = "owner" | "clinic_admin";

export async function signToken(email: string, role: SessionRole): Promise<string> {
  const payload = `${email}:${role}:${Date.now()}`;
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return btoa(`${payload}:${sigHex}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type SessionPayload = { email: string; role: SessionRole };

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const decoded = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    const lastColon = decoded.lastIndexOf(":");
    const payload = decoded.slice(0, lastColon);
    const sigHex = decoded.slice(lastColon + 1);
    const sigBytes = new Uint8Array(
      (sigHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    const key = await getKey();
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
    if (!valid) return null;

    // payload format: email:role:timestamp
    const parts = payload.split(":");
    if (parts.length < 3) return null;
    const email = parts[0];
    const role = parts[1] as SessionRole;
    if (role !== "owner" && role !== "clinic_admin") return null;
    return { email, role };
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE };
