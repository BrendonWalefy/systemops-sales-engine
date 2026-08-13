// Escala de atendimento por dia da semana. Ver
// docs/superpowers/specs/2026-08-13-per-day-business-hours-design.md
//
// O texto livre de businessHours só consegue expressar uma faixa de horário mais
// uma exceção de sábado, e alimenta o SlotEngine — então o que ele não consegue
// guardar virava disponibilidade errada, não apenas frase errada.
import { describe, expect, it } from "vitest";
import {
  resolveBusinessSchedule,
  scheduleFromParsedBusinessHours,
  windowsForWeekday,
  isOpenOnWeekday,
  operatingWeekdays,
  type BusinessSchedule,
} from "@/core/scheduling/BusinessSchedule";
import { parseBusinessHours } from "@/core/scheduling/ClinicTimezone";

const SEG_A_SEX_8_18: BusinessSchedule = {
  days: {
    1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    3: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
    5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
  },
};

describe("resolveBusinessSchedule — porta única de leitura", () => {
  it("usa a escala estruturada quando ela existe", () => {
    const schedule = resolveBusinessSchedule({
      businessSchedule: SEG_A_SEX_8_18,
      businessHours: "isso deve ser ignorado",
    });
    expect(windowsForWeekday(schedule, 1)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
  });

  it("deriva do texto legado quando não há escala", () => {
    const schedule = resolveBusinessSchedule({
      businessSchedule: null,
      businessHours: "seg-sex 9h-17h",
    });
    expect(windowsForWeekday(schedule, 3)).toEqual([
      { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
    ]);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
    expect(isOpenOnWeekday(schedule, 0)).toBe(false);
  });

  it("cai no padrão de segunda a sexta 8h-18h quando não há nem escala nem texto", () => {
    const schedule = resolveBusinessSchedule({ businessSchedule: null, businessHours: null });
    expect(isOpenOnWeekday(schedule, 1)).toBe(true);
    expect(isOpenOnWeekday(schedule, 5)).toBe(true);
    expect(isOpenOnWeekday(schedule, 6)).toBe(false);
    expect(windowsForWeekday(schedule, 1)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
  });
});

describe("scheduleFromParsedBusinessHours — equivalência com o parser legado", () => {
  it("preserva a faixa geral nos dias de operação", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg a sex das 8h30 às 18h"));
    expect(windowsForWeekday(schedule, 2)).toEqual([
      { startHour: 8, startMinute: 30, endHour: 18, endMinute: 0 },
    ]);
  });

  it("aplica o horário específico de sábado quando o texto o declara", () => {
    const schedule = scheduleFromParsedBusinessHours(
      parseBusinessHours("seg-sex 8h-18h, sáb 8h-13h"),
    );
    expect(windowsForWeekday(schedule, 5)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
    expect(windowsForWeekday(schedule, 6)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 13, endMinute: 0 },
    ]);
  });

  it("sábado sem horário próprio herda a faixa geral — comportamento de hoje, preservado", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg a sáb 8h-18h"));
    expect(windowsForWeekday(schedule, 6)).toEqual([
      { startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 },
    ]);
  });

  it("dia fora da lista de operação fica sem janela", () => {
    const schedule = scheduleFromParsedBusinessHours(parseBusinessHours("seg-sex 8h-18h"));
    expect(windowsForWeekday(schedule, 0)).toEqual([]);
    expect(isOpenOnWeekday(schedule, 0)).toBe(false);
  });
});

describe("escalas que o texto livre nunca conseguiu expressar", () => {
  it("clínica fechada no meio da semana", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
      },
    };
    expect(isOpenOnWeekday(schedule, 3)).toBe(false);
    expect(isOpenOnWeekday(schedule, 4)).toBe(true);
  });

  it("dois turnos no mesmo dia com intervalo de almoço", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
        ],
      },
    };
    const windows = windowsForWeekday(schedule, 1);
    expect(windows).toHaveLength(2);
    expect(windows[0].endHour).toBe(12);
    expect(windows[1].startHour).toBe(14);
  });

  it("janelas de um dia saem ordenadas por horário, mesmo declaradas fora de ordem", () => {
    const schedule: BusinessSchedule = {
      days: {
        1: [
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
        ],
      },
    };
    expect(windowsForWeekday(schedule, 1).map((w) => w.startHour)).toEqual([8, 14]);
  });
});

// Gate de equivalência do backfill: para cada formato de texto que existe no
// banco hoje, a escala derivada tem de reproduzir exatamente os dias e horários
// que o parser legado produz. O backfill não pode mudar disponibilidade.
describe("equivalência do backfill sobre formatos reais de texto", () => {
  const TEXTOS = [
    "seg-sex 8h-18h",
    "Segunda a sexta, das 8h às 18h",
    "seg a sex 9h30-18h30",
    "08:30-18:00",
    "seg-sex 8h-18h, sáb 8h-13h",
    "segunda a sábado 8h-19h",
    "seg-sex 7h-21h",
    "Seg-Sex 10:00-19:00, Sábado 9h às 14h",
  ];

  for (const texto of TEXTOS) {
    it(`preserva dias e horários de ${JSON.stringify(texto)}`, () => {
      const parsed = parseBusinessHours(texto);
      const schedule = scheduleFromParsedBusinessHours(parsed);

      // mesmos dias de operação
      expect(operatingWeekdays(schedule)).toEqual([...parsed.days].sort((a, b) => a - b));

      // mesma faixa nos dias não-sábado
      for (const weekday of parsed.days.filter((d) => d !== 6)) {
        expect(windowsForWeekday(schedule, weekday)).toEqual([
          {
            startHour: parsed.startHour,
            startMinute: parsed.startMinute,
            endHour: parsed.endHour,
            endMinute: parsed.endMinute,
          },
        ]);
      }

      // sábado: faixa própria quando o texto a declara, geral quando não
      if (parsed.days.includes(6)) {
        const esperado = parsed.saturdayStartHour !== undefined && parsed.saturdayEndHour !== undefined
          ? {
              startHour: parsed.saturdayStartHour,
              startMinute: parsed.saturdayStartMinute ?? 0,
              endHour: parsed.saturdayEndHour,
              endMinute: parsed.saturdayEndMinute ?? 0,
            }
          : {
              startHour: parsed.startHour,
              startMinute: parsed.startMinute,
              endHour: parsed.endHour,
              endMinute: parsed.endMinute,
            };
        expect(windowsForWeekday(schedule, 6)).toEqual([esperado]);
      }
    });
  }
});
