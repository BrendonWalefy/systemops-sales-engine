// Residual do debounce quando parte da janela já correu na fila.
//
// A janela de agrupamento de rajada (15s) passou de sono do worker para atraso
// do job (run_at = recebimento + janela). O orquestrador só dorme o que ainda
// falta desde o recebimento; um job que esperou tudo na fila dorme zero e passa
// direto para a checagem de supersessão. É essa aritmética que garante que uma
// rajada de N mensagens não segura N workers dormindo 15s cada.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_DEBOUNCE_MS,
  computeResidualDebounceMs,
} from "@/core/pipeline/message-debounce";

describe("computeResidualDebounceMs", () => {
  it("é zero quando a janela já correu inteira na fila", () => {
    // Cron do worker acordou depois do run_at agendado (recebimento + 15s):
    // não sobra nada para dormir dentro do worker.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:15.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: DEFAULT_MESSAGE_DEBOUNCE_MS,
      receivedAt,
      now,
    })).toBe(0);
  });

  it("também é zero quando o worker acorda depois do run_at agendado", () => {
    // Cron rodou depois do tick mínimo: mesma consequência, sem sono.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:42.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: DEFAULT_MESSAGE_DEBOUNCE_MS,
      receivedAt,
      now,
    })).toBe(0);
  });

  it("devolve o restante quando o worker acordou dentro da janela", () => {
    // Se o worker pegou o job 5s depois do recebimento, ainda faltam 10s
    // para completar a janela de 15s.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:05.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: DEFAULT_MESSAGE_DEBOUNCE_MS,
      receivedAt,
      now,
    })).toBe(10_000);
  });

  it("devolve a janela inteira quando nada correu ainda", () => {
    // Caso degenerado: worker acordou no mesmo instante do recebimento.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: DEFAULT_MESSAGE_DEBOUNCE_MS,
      receivedAt,
      now,
    })).toBe(DEFAULT_MESSAGE_DEBOUNCE_MS);
  });

  it("respeita clínica configurada acima da janela agendada", () => {
    // O scheduler agenda com o default de plataforma (15s). Uma clínica que
    // pediu 30s ainda tem 15s pela frente quando o worker acorda no run_at,
    // e o resíduo entrega os 15s que faltam. Sem isso, quem configurou mais
    // ganharia menos.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:15.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: 30_000,
      receivedAt,
      now,
    })).toBe(15_000);
  });

  it("é zero quando o debounce resolvido já é zero (replay ou sandbox)", () => {
    // resolveMessageDebounceMs retorna 0 no replay e no harness; o resíduo
    // preserva esse zero em vez de dormir por causa de aritmética de tempo.
    const receivedAt = new Date("2026-08-24T12:00:00.000Z");
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: 0,
      receivedAt,
      now,
    })).toBe(0);
  });

  it("clampa em zero quando o relógio pulou (recebimento futuro)", () => {
    // Se por qualquer razão o now injetado for anterior ao recebimento, o
    // orquestrador não pode dormir MAIS que a janela. Evita esperas absurdas.
    const receivedAt = new Date("2026-08-24T12:00:10.000Z");
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(computeResidualDebounceMs({
      debounceMs: DEFAULT_MESSAGE_DEBOUNCE_MS,
      receivedAt,
      now,
    })).toBe(DEFAULT_MESSAGE_DEBOUNCE_MS);
  });
});
