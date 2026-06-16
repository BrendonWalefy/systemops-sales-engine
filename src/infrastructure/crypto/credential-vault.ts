import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const ENC_PREFIX = "enc:v1:";
const MAX_ENCRYPTION_LAYERS = 3;

function getKey(): Buffer {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) throw new Error("CREDENTIAL_ENCRYPTION_KEY not set");
  if (hex.length !== 64)
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

function decryptCredentialOnce(value: string): string {
  const key = getKey();
  const rest = value.slice(ENC_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) throw new Error("Formato de credencial encriptada inválido");
  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function decryptCredential(value: string): string {
  if (!isEncryptedCredential(value)) {
    // Credencial em plaintext ainda não migrada — aceitar durante período de migração
    if (process.env.NODE_ENV === "production") {
      console.warn("[credential-vault] Credencial em plaintext detectada — execute o script de migração");
    }
    return value;
  }

  let current = value;
  let layers = 0;

  while (isEncryptedCredential(current)) {
    layers += 1;
    if (layers > MAX_ENCRYPTION_LAYERS) {
      throw new Error("Profundidade máxima de encriptação excedida");
    }
    current = decryptCredentialOnce(current);
  }

  if (layers > 1 && process.env.NODE_ENV === "production") {
    console.warn(`[credential-vault] Credencial com ${layers} camadas detectada e normalizada em runtime`);
  }

  return current;
}

export function encryptCredentialNullable(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (isEncryptedCredential(value)) return value;
  return encryptCredential(value);
}

export function decryptCredentialNullable(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return decryptCredential(value);
}
