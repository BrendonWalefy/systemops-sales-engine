// O agendamento dos crons é uma decisão de CUSTO, não só de produto.
//
// O Neon suspende o compute depois de um período de inatividade e cobra por
// tempo ATIVO, não por consulta. Portanto o que decide a conta não é quantas
// consultas os crons fazem — é quantas JANELAS DE ACORDAR eles abrem por hora.
// Um cron novo no minuto :17 abre uma sétima janela sozinho, e nenhuma revisão
// de código repara nisso olhando o diff de um arquivo de agenda.
//
// Estado medido em 22/08/2026, antes desta grade: dois workers de 1 em 1
// minuto mantinham `pg_postmaster_start_time()` em 18/07/2026 — 35 dias de
// compute ininterrupto — com ZERO clínica com resposta automática ligada.
// 255,54 CU-horas no ciclo, com 0,11 GB de armazenamento.
//
// A resposta ao lead não depende mais desta grade: o webhook acorda o worker
// ao gravar o job (`request-message-worker-run.ts`). O cron é rede de
// segurança.

import { describe, expect, it } from "vitest";
import vercelConfig from "../../vercel.json";

/** Toda janela de acordar tem de cair na mesma grade de 10 minutos. */
const WAKE_GRID_MINUTES = 10;

type CronEntry = { path: string; schedule: string };

const crons: CronEntry[] = vercelConfig.crons;

/** Minutos do ciclo de uma hora em que um campo de minuto do cron dispara. */
function minutesOf(minuteField: string): number[] {
  if (minuteField === "*") return Array.from({ length: 60 }, (_, minute) => minute);

  const minutes = new Set<number>();
  for (const part of minuteField.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[2]);
      const [from, to] = stepMatch[1] === "*"
        ? [0, 59]
        : stepMatch[1].includes("-")
          ? stepMatch[1].split("-").map(Number)
          : [Number(stepMatch[1]), 59];
      for (let minute = from; minute <= to; minute += step) minutes.add(minute);
      continue;
    }
    if (part.includes("-")) {
      const [from, to] = part.split("-").map(Number);
      for (let minute = from; minute <= to; minute += 1) minutes.add(minute);
      continue;
    }
    minutes.add(Number(part));
  }
  return [...minutes].sort((a, b) => a - b);
}

describe("grade de acordar do Postgres", () => {
  it("todo cron dispara em minuto múltiplo de 10", () => {
    const offGrid = crons
      .map((cron) => ({ path: cron.path, minutes: minutesOf(cron.schedule.split(" ")[0]) }))
      .filter((cron) => cron.minutes.some((minute) => minute % WAKE_GRID_MINUTES !== 0));

    expect(offGrid).toEqual([]);
  });

  it("a união de todos os crons abre no máximo 6 janelas por hora", () => {
    const windows = new Set<number>();
    for (const cron of crons) {
      for (const minute of minutesOf(cron.schedule.split(" ")[0])) windows.add(minute);
    }

    // Seis janelas é o que a grade de 10 minutos permite. Sete significa que
    // alguém entrou fora da grade — e o compute deixa de dormir na diferença.
    expect([...windows].sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it("nenhum cron roda de minuto em minuto", () => {
    const perMinute = crons.filter((cron) => cron.schedule.split(" ")[0] === "*");

    // Um único cron por minuto zera todo o resto: o compute nunca fica
    // inativo tempo suficiente para suspender, e a grade acima vira enfeite.
    expect(perMinute).toEqual([]);
  });
});

describe("colocação das funções com o banco", () => {
  it("as funções rodam na mesma região do Neon (aws-sa-east-1)", () => {
    // Com as funções em iad1 e o banco em sa-east-1, cada ida e volta
    // sequencial ao Postgres custava ~131 ms de rede — medido em produção,
    // contra ~11 ms de São Paulo para o mesmo endpoint. Nenhuma consulta
    // ficou mais barata: o que mudou foi a distância.
    expect(vercelConfig.regions).toEqual(["gru1"]);
  });
});
