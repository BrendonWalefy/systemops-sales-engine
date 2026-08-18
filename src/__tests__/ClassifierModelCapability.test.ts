// gpt-5.5+ e a família gpt-5-mini/nano rejeitam temperature != 1 com HTTP 400.
// O flag existe para o benchmark de modelo poder alcançá-los sem mudar o
// comportamento dos modelos que já rodam em produção.
import { describe, expect, it } from "vitest";
import { supportsTemperatureZero } from "@/core/intelligence/IntentClassifier";

describe("supportsTemperatureZero", () => {
  it("mantém temperature 0 no modelo de produção — zero mudança de comportamento", () => {
    expect(supportsTemperatureZero("gpt-4o-mini")).toBe(true);
  });

  it("mantém temperature 0 nas famílias 4o, 4.1 e 5.4, que aceitam o parâmetro", () => {
    for (const model of ["gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4"]) {
      expect(supportsTemperatureZero(model)).toBe(true);
    }
  });

  it("omite temperature nos modelos que a rejeitam", () => {
    for (const model of ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5-mini", "gpt-5-nano"]) {
      expect(supportsTemperatureZero(model)).toBe(false);
    }
  });

  it("não confunde gpt-5.4 com gpt-5.5 nem gpt-5-nano com gpt-5.4-nano", () => {
    expect(supportsTemperatureZero("gpt-5.4-nano")).toBe(true);
    expect(supportsTemperatureZero("gpt-5-nano")).toBe(false);
  });
});
