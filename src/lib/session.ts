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

// "owner" | "clinic_admin" — mantido para resolve-clinic.ts (não alterar semântica)
export type SessionRole = "owner" | "clinic_admin";

// Papel granular: inclui receptionist e professional além dos papéis de sessão
export type MemberRole = "owner" | "clinic_admin" | "receptionist" | "professional";

export type SessionPayload = {
  email: string;
  role: SessionRole;        // para resolve-clinic.ts
  memberRole: MemberRole;   // papel granular — novo
  professionalId: string | null; // preenchido quando memberRole === "professional"
};

export async function signToken(payload: SessionPayload): Promise<string> {
  const json = JSON.stringify({ ...payload, iat: Date.now() });
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(json));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return btoa(`${json}:${sigHex}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const decoded = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    const lastColon = decoded.lastIndexOf(":");
    const json = decoded.slice(0, lastColon);
    const sigHex = decoded.slice(lastColon + 1);
    const sigBytes = new Uint8Array(
      (sigHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    const key = await getKey();
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(json));
    if (!valid) return null;

    const parsed = JSON.parse(json);
    const { email, role, memberRole, professionalId } = parsed;
    if (!email || (role !== "owner" && role !== "clinic_admin")) return null;

    const validMemberRoles: MemberRole[] = ["owner", "clinic_admin", "receptionist", "professional"];
    const resolvedMemberRole: MemberRole = validMemberRoles.includes(memberRole) ? memberRole : role;

    return {
      email,
      role: role as SessionRole,
      memberRole: resolvedMemberRole,
      professionalId: professionalId ?? null,
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE };
