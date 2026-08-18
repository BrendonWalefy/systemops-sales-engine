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
  detectWeekdayQuestion,
  describeWeekdayHours,
  isOpenAtLocalTime,
  type BusinessSchedule,
} from "@/core/scheduling/BusinessSchedule";
import { parseBusinessHours, ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";

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

describe("detectWeekdayQuestion — os sete dias, não só sábado", () => {
  it("reconhece cada dia da semana", () => {
    expect(detectWeekdayQuestion("vocês atendem na segunda?")).toBe(1);
    expect(detectWeekdayQuestion("abre quarta?")).toBe(3);
    expect(detectWeekdayQuestion("tem atendimento quinta")).toBe(4);
    expect(detectWeekdayQuestion("e na sexta?")).toBe(5);
    expect(detectWeekdayQuestion("atendem sabado?")).toBe(6);
    expect(detectWeekdayQuestion("e domingo?")).toBe(0);
  });

  it("não confunde o verbo 'ter' com terça-feira", () => {
    expect(detectWeekdayQuestion("queria ter um horario essa semana")).toBeNull();
    expect(detectWeekdayQuestion("posso ter mais informacoes?")).toBeNull();
  });

  it("reconhece terça quando é realmente o dia", () => {
    expect(detectWeekdayQuestion("atendem na terca?")).toBe(2);
  });

  it("faixa de dias não é pergunta sobre um dia específico", () => {
    expect(detectWeekdayQuestion("de segunda a sexta vocês abrem?")).toBeNull();
  });

  it("mensagem sem dia devolve null", () => {
    expect(detectWeekdayQuestion("quanto custa a lente?")).toBeNull();
  });
});

describe("describeWeekdayHours e isOpenAtLocalTime", () => {
  const COM_ALMOCO: BusinessSchedule = {
    days: {
      1: [
        { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
        { startHour: 14, startMinute: 0, endHour: 18, endMinute: 30 },
      ],
    },
  };

  it("descreve dois turnos em prosa", () => {
    expect(describeWeekdayHours(COM_ALMOCO, 1)).toBe("8h às 12h e 14h às 18h30");
  });

  it("dia fechado descreve como null", () => {
    expect(describeWeekdayHours(COM_ALMOCO, 3)).toBeNull();
  });

  it("horário no intervalo de almoço está fechado — hoje isso é invisível", () => {
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 10, 0)).toBe(true);
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 13, 0)).toBe(false);
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 15, 0)).toBe(true);
  });

  it("fim de janela é exclusivo", () => {
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 12, 0)).toBe(false);
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 11, 30)).toBe(true);
    expect(isOpenAtLocalTime(COM_ALMOCO, 1, 18, 30)).toBe(false);
  });
});

// ── Escala por dia no SlotEngine ─────────────────────────────────────────────
// Os três cenários abaixo são IMPOSSÍVEIS de expressar no texto legado de
// business_hours, e por isso produziam disponibilidade errada.
describe("computeAvailableSlots com escala por dia", () => {
  const tz = new ClinicTimezone("America/Sao_Paulo");
  // Seg 17/08/2026 a Sáb 22/08/2026
  const from = new Date("2026-08-17T03:00:00.000Z"); // 00:00 local de segunda
  const to = new Date("2026-08-23T03:00:00.000Z");

  function slotsWith(businessSchedule: BusinessSchedule, slotDurationMinutes = 60) {
    return computeAvailableSlots({
      timezone: tz,
      businessHours: parseBusinessHours("seg-sex 8h-18h"),
      businessSchedule,
      existingEvents: [],
      from,
      to,
      slotDurationMinutes,
      clinicId: "clinic-1",
      maxSlots: 500,
    });
  }

  function weekdaysOffered(slots: { startsAt: Date }[]): number[] {
    return [...new Set(slots.map((s) => tz.toLocalParts(s.startsAt).weekday))].sort();
  }

  it("clínica fechada na quarta não oferece slot na quarta", () => {
    const slots = slotsWith({
      days: {
        1: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        2: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        4: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
      },
    });
    expect(weekdaysOffered(slots)).toEqual([1, 2, 4, 5]);
  });

  it("intervalo de almoço não é ofertado", () => {
    const slots = slotsWith({
      days: {
        1: [
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
        ],
      },
    });
    const horas = slots
      .filter((s) => tz.toLocalParts(s.startsAt).weekday === 1)
      .map((s) => tz.toLocalParts(s.startsAt).hour);
    expect(horas).toContain(11);
    expect(horas).not.toContain(12);
    expect(horas).not.toContain(13);
    expect(horas).toContain(14);
  });

  it("slot não atravessa o almoço — um de 60min às 11h30 não existe", () => {
    const slots = slotsWith({
      days: {
        1: [
          { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 },
          { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 },
        ],
      },
    }, 60);
    const inicios = slots
      .filter((s) => tz.toLocalParts(s.startsAt).weekday === 1)
      .map((s) => `${tz.toLocalParts(s.startsAt).hour}:${tz.toLocalParts(s.startsAt).minute}`);
    expect(inicios).not.toContain("11:30");
    expect(inicios).toContain("11:0");
  });

  it("horário reduzido no sábado é respeitado", () => {
    const slots = slotsWith({
      days: {
        5: [{ startHour: 8, startMinute: 0, endHour: 18, endMinute: 0 }],
        6: [{ startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 }],
      },
    });
    const sabado = slots
      .filter((s) => tz.toLocalParts(s.startsAt).weekday === 6)
      .map((s) => tz.toLocalParts(s.startsAt).hour);
    expect(sabado.length).toBeGreaterThan(0);
    expect(Math.max(...sabado)).toBeLessThan(12);
  });

  it("sem escala, o comportamento é o de antes — texto legado governa", () => {
    const slots = computeAvailableSlots({
      timezone: tz,
      businessHours: parseBusinessHours("seg-sex 8h-18h"),
      existingEvents: [],
      from, to,
      slotDurationMinutes: 60,
      clinicId: "clinic-1",
      maxSlots: 500,
    });
    expect(weekdaysOffered(slots)).toEqual([1, 2, 3, 4, 5]);
  });
});
