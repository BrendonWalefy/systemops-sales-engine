import { describe, expect, it } from "vitest";
import {
  fingerprintRuntimeConfig,
  sanitizeRuntimeConfig,
} from "@/application/config/runtime-config-fingerprint";

describe("runtime config fingerprint", () => {
  it("é estável independentemente da ordem das chaves", () => {
    const left = fingerprintRuntimeConfig({
      clinic: { timezone: "America/Sao_Paulo", maxSlotsToOffer: 5 },
      editorial: { tone: "acolhedor" },
      modules: [{ key: "concierge_mode", config: { drive: "sempre_proximo_passo" } }],
    });
    const right = fingerprintRuntimeConfig({
      clinic: { maxSlotsToOffer: 5, timezone: "America/Sao_Paulo" },
      editorial: { tone: "acolhedor" },
      modules: [{ config: { drive: "sempre_proximo_passo" }, key: "concierge_mode" }],
    });
    expect(left).toEqual(right);
    expect(left.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("muda quando qualquer regra comportamental muda", () => {
    const base = {
      clinic: { maxSlotsToOffer: 5 },
      editorial: { commercialPolicy: "Valor A" },
      modules: [],
    };
    expect(fingerprintRuntimeConfig(base).fingerprint).not.toBe(
      fingerprintRuntimeConfig({
        ...base,
        clinic: { maxSlotsToOffer: 6 },
      }).fingerprint,
    );
  });

  it("não carrega credenciais para o snapshot sanitizado", () => {
    expect(sanitizeRuntimeConfig({
      zapiToken: "segredo-1",
      metaAppSecret: "segredo-2",
      timezone: "America/Sao_Paulo",
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    })).toEqual({
      metaAppSecret: true,
      timezone: "America/Sao_Paulo",
      zapiToken: true,
    });
  });
});
