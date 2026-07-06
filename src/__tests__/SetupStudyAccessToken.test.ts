/**
 * Testes do token de acesso e da resolução de estado da página pública de
 * validação (ADR-002 Fase 2).
 */

import { describe, expect, it } from "vitest";
import {
  generateAccessToken,
  hashAccessToken,
  resolveStudyState,
} from "@/application/setup-study/access-token";

describe("generateAccessToken / hashAccessToken", () => {
  it("gera token base64url com hash sha256 consistente", () => {
    const { token, hash } = generateAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, sem padding
    expect(hash).toHaveLength(64); // sha256 hex
    expect(hashAccessToken(token)).toBe(hash); // round-trip determinístico
  });

  it("tokens diferentes produzem hashes diferentes", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("nunca expõe o token cru a partir do hash (hash não reversível por igualdade)", () => {
    const { token, hash } = generateAccessToken();
    expect(hash).not.toContain(token);
  });
});

describe("resolveStudyState", () => {
  const future = new Date("2026-08-01T00:00:00Z");
  const past = new Date("2026-06-01T00:00:00Z");
  const now = new Date("2026-07-10T00:00:00Z");

  it("null/undefined → invalid", () => {
    expect(resolveStudyState(null, now)).toBe("invalid");
    expect(resolveStudyState(undefined, now)).toBe("invalid");
  });

  it("draft (nunca enviado) → invalid", () => {
    expect(resolveStudyState({ status: "draft", expiresAt: future }, now)).toBe("invalid");
  });

  it("sent dentro da validade → valid", () => {
    expect(resolveStudyState({ status: "sent", expiresAt: future }, now)).toBe("valid");
  });

  it("sent com expires_at no passado → expired", () => {
    expect(resolveStudyState({ status: "sent", expiresAt: past }, now)).toBe("expired");
  });

  it("status expired → expired mesmo com data futura", () => {
    expect(resolveStudyState({ status: "expired", expiresAt: future }, now)).toBe("expired");
  });

  it("answered/applied → answered (precede expiração)", () => {
    expect(resolveStudyState({ status: "answered", expiresAt: past }, now)).toBe("answered");
    expect(resolveStudyState({ status: "applied", expiresAt: past }, now)).toBe("answered");
  });

  it("sent sem expires_at → valid (sem prazo definido)", () => {
    expect(resolveStudyState({ status: "sent", expiresAt: null }, now)).toBe("valid");
  });
});
