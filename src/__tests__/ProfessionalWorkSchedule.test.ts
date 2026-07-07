import { describe, expect, it } from "vitest";
import { formatWorkScheduleSummary, isValidWorkSchedule } from "@/domain/entities/professional";

describe("isValidWorkSchedule", () => {
  it("aceita objeto vazio (profissional sem nenhum dia de atendimento)", () => {
    expect(isValidWorkSchedule({})).toBe(true);
  });

  it("aceita janelas válidas em dias válidos", () => {
    expect(
      isValidWorkSchedule({
        2: { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
        4: { startHour: 9, startMinute: 30, endHour: 12, endMinute: 0 },
      }),
    ).toBe(true);
  });

  it("rejeita chave de dia da semana fora de 0-6", () => {
    expect(isValidWorkSchedule({ 7: { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 } })).toBe(false);
  });

  it("rejeita janela onde o fim não é depois do início", () => {
    expect(isValidWorkSchedule({ 1: { startHour: 18, startMinute: 0, endHour: 8, endMinute: 0 } })).toBe(false);
    expect(isValidWorkSchedule({ 1: { startHour: 8, startMinute: 0, endHour: 8, endMinute: 0 } })).toBe(false);
  });

  it("rejeita hora/minuto fora do intervalo válido", () => {
    expect(isValidWorkSchedule({ 1: { startHour: 24, startMinute: 0, endHour: 25, endMinute: 0 } })).toBe(false);
    expect(isValidWorkSchedule({ 1: { startHour: 8, startMinute: 60, endHour: 18, endMinute: 0 } })).toBe(false);
  });

  it("rejeita valores não-objeto e arrays", () => {
    expect(isValidWorkSchedule(null)).toBe(false);
    expect(isValidWorkSchedule("invalid")).toBe(false);
    expect(isValidWorkSchedule([])).toBe(false);
  });
});

describe("formatWorkScheduleSummary", () => {
  it("retorna null quando não há grade própria (segue o horário da clínica)", () => {
    expect(formatWorkScheduleSummary(null)).toBeNull();
  });

  it("indica explicitamente quando a grade própria não tem nenhum dia", () => {
    expect(formatWorkScheduleSummary({})).toBe("Sem dias de atendimento definidos");
  });

  it("formata os dias em ordem Seg..Dom, não na ordem das chaves", () => {
    const summary = formatWorkScheduleSummary({
      0: { startHour: 10, startMinute: 0, endHour: 12, endMinute: 0 },
      2: { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
    });
    expect(summary).toBe("Ter 14:00–18:00 · Dom 10:00–12:00");
  });
});
