// PBKDF2-SHA256 via Web Crypto, sem dependências externas.
// As iterações são gravadas no próprio hash, então elevar o custo no futuro
// NÃO quebra senhas já salvas (cada hash carrega o custo com que foi gerado).
const ITERATIONS = 600_000; // piso atual recomendado (OWASP) p/ PBKDF2-SHA256
const KEY_LENGTH = 32;
const ALGORITHM = "SHA-256";
const LEGACY_ITERATIONS = 100_000; // hashes antigos (formato de 3 partes)

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

async function deriveKey(password: string, salt: ArrayBuffer, iterations: number): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: ALGORITHM },
    baseKey,
    KEY_LENGTH * 8,
  );
}

/** Retorna "pbkdf2:<iterations>:<salt_hex>:<hash_hex>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveKey(password, salt.buffer as ArrayBuffer, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${bytesToHex(salt.buffer as ArrayBuffer)}:${bytesToHex(bits)}`;
}

/**
 * Compara senha com o hash armazenado. Aceita o formato novo de 4 partes
 * (com iterações) e o legado de 3 partes (assume 100k). Constant-time no
 * loop de bytes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  let saltHex: string;
  let expectedHex: string;
  let iterations: number;

  if (parts.length === 4 && parts[0] === "pbkdf2") {
    iterations = parseInt(parts[1], 10) || ITERATIONS;
    saltHex = parts[2];
    expectedHex = parts[3];
  } else if (parts.length === 3 && parts[0] === "pbkdf2") {
    iterations = LEGACY_ITERATIONS;
    saltHex = parts[1];
    expectedHex = parts[2];
  } else {
    return false;
  }

  const salt = hexToBytes(saltHex);
  const expected = hexToBytes(expectedHex);
  const bits = await deriveKey(password, salt.buffer as ArrayBuffer, iterations);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// Hash "descartável" usado para equalizar o tempo de resposta do login quando
// o email não existe (evita oráculo de timing de enumeração de usuários).
const DUMMY_HASH =
  "pbkdf2:600000:00000000000000000000000000000000:" +
  "0000000000000000000000000000000000000000000000000000000000000000";

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH).catch(() => false);
}
