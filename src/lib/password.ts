const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const ALGORITHM = "SHA-256";

const enc = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr as Uint8Array<ArrayBuffer>;
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: ALGORITHM },
    baseKey,
    KEY_LENGTH * 8,
  );
}

/** Retorna "pbkdf2:<salt_hex>:<hash_hex>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveKey(password, salt.buffer as ArrayBuffer);
  return `pbkdf2:${bytesToHex(salt.buffer as ArrayBuffer)}:${bytesToHex(bits)}`;
}

/** Compara senha com o hash armazenado. Constant-time ao nível do loop de bytes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const salt = hexToBytes(parts[1]);
  const expected = hexToBytes(parts[2]);
  const bits = await deriveKey(password, salt.buffer as ArrayBuffer);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
