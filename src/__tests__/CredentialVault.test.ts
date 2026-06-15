import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  encryptCredentialNullable,
  decryptCredentialNullable,
} from "@/infrastructure/crypto/credential-vault";

const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
});

describe("encryptCredential / decryptCredential", () => {
  it("round-trip preserva o plaintext", () => {
    const original = "meu-token-secreto-123";
    const encrypted = encryptCredential(original);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(original);
    expect(decryptCredential(encrypted)).toBe(original);
  });

  it("gera ciphertexts diferentes a cada chamada (IV aleatório)", () => {
    const t = "mesmo-plaintext";
    expect(encryptCredential(t)).not.toBe(encryptCredential(t));
  });

  it("aceita plaintext legado sem prefixo (modo migração)", () => {
    const legacyToken = "token-em-plaintext";
    expect(decryptCredential(legacyToken)).toBe(legacyToken);
  });

  it("lança erro para formato encriptado corrompido", () => {
    expect(() => decryptCredential("enc:v1:invalido")).toThrow();
  });

  it("lança erro se CREDENTIAL_ENCRYPTION_KEY não está definida", () => {
    const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptCredential("x")).toThrow("CREDENTIAL_ENCRYPTION_KEY not set");
    process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });
});

describe("encryptCredentialNullable / decryptCredentialNullable", () => {
  it("retorna null para input null", () => {
    expect(encryptCredentialNullable(null)).toBeNull();
    expect(decryptCredentialNullable(null)).toBeNull();
  });

  it("retorna null para input undefined", () => {
    expect(encryptCredentialNullable(undefined)).toBeNull();
    expect(decryptCredentialNullable(undefined)).toBeNull();
  });

  it("retorna null para string vazia", () => {
    expect(encryptCredentialNullable("")).toBeNull();
    expect(decryptCredentialNullable("")).toBeNull();
  });

  it("round-trip com nullable", () => {
    const v = "token-nullable";
    const enc = encryptCredentialNullable(v);
    expect(enc).not.toBeNull();
    expect(decryptCredentialNullable(enc)).toBe(v);
  });
});
