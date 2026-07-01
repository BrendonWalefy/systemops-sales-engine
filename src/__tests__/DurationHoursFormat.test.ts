import { describe, expect, it } from "vitest";
import { formatDurationLabel, hmToMinutes, minutesToHm } from "@/core/scheduling/durationFormat";

describe("durationFormat", () => {
  describe("minutesToHm", () => {
    it("converte minutos puros", () => {
      expect(minutesToHm(45)).toEqual({ hours: 0, minutes: 45 });
    });

    it("converte horas exatas", () => {
      expect(minutesToHm(120)).toEqual({ hours: 2, minutes: 0 });
    });

    it("converte horas com resto de minutos", () => {
      expect(minutesToHm(150)).toEqual({ hours: 2, minutes: 30 });
    });

    it("nunca retorna negativo", () => {
      expect(minutesToHm(-30)).toEqual({ hours: 0, minutes: 0 });
    });

    it("arredonda valores fracionários", () => {
      expect(minutesToHm(90.6)).toEqual({ hours: 1, minutes: 31 });
    });
  });

  describe("hmToMinutes", () => {
    it("combina horas e minutos", () => {
      expect(hmToMinutes(2, 30)).toBe(150);
    });

    it("aceita duração longa (procedimentos de múltiplas horas)", () => {
      expect(hmToMinutes(6, 0)).toBe(360);
    });

    it("trata negativos como zero", () => {
      expect(hmToMinutes(-1, -5)).toBe(0);
    });

    it("é a inversa de minutesToHm", () => {
      const { hours, minutes } = minutesToHm(275);
      expect(hmToMinutes(hours, minutes)).toBe(275);
    });
  });

  describe("formatDurationLabel", () => {
    it("mostra só minutos quando < 1h", () => {
      expect(formatDurationLabel(45)).toBe("45 min");
    });

    it("mostra só horas quando é hora exata", () => {
      expect(formatDurationLabel(120)).toBe("2h");
    });

    it("mostra horas e minutos combinados", () => {
      expect(formatDurationLabel(150)).toBe("2h30");
    });

    it("preenche minutos com zero à esquerda", () => {
      expect(formatDurationLabel(125)).toBe("2h05");
    });

    it("funciona para procedimentos longos (ex: protocolo full-arch de 6h)", () => {
      expect(formatDurationLabel(360)).toBe("6h");
    });
  });
});
