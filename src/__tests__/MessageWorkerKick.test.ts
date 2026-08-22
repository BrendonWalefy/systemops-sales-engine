// Quem cria trabalho é que anuncia o trabalho.
//
// Antes: o webhook gravava o job e ia embora; um cron de 1 em 1 minuto era o
// único caminho até o orquestrador. Isso custava até 60 s de espera para o
// lead E impedia o Neon de suspender o compute — um toque por minuto no
// Postgres nunca deixa o autosuspend de 300 s vencer. Medido em 22/08/2026,
// `pg_postmaster_start_time()` de produção era 18/07: 35 dias de compute
// ininterrupto, com zero clínica com resposta automática ligada.
//
// Estes testes fixam as três propriedades que tornam a troca segura:
// só acorda quando o trabalho é novo, nunca derruba o webhook, e o cron
// continua sendo a rede de segurança (o kick não substitui, complementa).

import { describe, expect, it, vi } from "vitest";
import {
  requestMessageWorkerRun,
  resolveWorkerBaseUrl,
  scheduleMessageWorkerKick,
} from "@/application/jobs/request-message-worker-run";

const BASE_ENV = {
  CRON_SECRET: "cron-secret",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
};

describe("resolveWorkerBaseUrl", () => {
  it("prefere a URL pública configurada, sem barra sobrando", () => {
    expect(resolveWorkerBaseUrl({ NEXT_PUBLIC_APP_URL: "https://a.test/" }))
      .toBe("https://a.test");
  });

  it("cai no host da própria implantação quando não há URL pública", () => {
    expect(resolveWorkerBaseUrl({ VERCEL_URL: "dpl-123.vercel.app" }))
      .toBe("https://dpl-123.vercel.app");
  });

  it("sem base nenhuma não inventa host", () => {
    expect(resolveWorkerBaseUrl({})).toBeNull();
  });
});

describe("requestMessageWorkerRun", () => {
  it("chama o worker em modo ack, autenticado com o segredo do cron", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    const result = await requestMessageWorkerRun({ env: BASE_ENV, fetchImpl });

    expect(result).toEqual({ requested: true, status: 202 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // `ack=1` é o que faz o worker responder na hora e drenar em `after()`.
    // Sem ele, esta chamada ficaria presa até o drenar inteiro terminar.
    expect(url).toBe("https://app.example.test/api/cron/message-worker?ack=1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cron-secret");
  });

  it("uma falha de rede não vira exceção — degrada para o cron", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(requestMessageWorkerRun({ env: BASE_ENV, fetchImpl })).resolves.toEqual({
      requested: false,
      reason: "failed",
    });
  });

  it("sem CRON_SECRET não chama nada — a rota rejeitaria de qualquer forma", async () => {
    const fetchImpl = vi.fn();

    const result = await requestMessageWorkerRun({
      env: { NEXT_PUBLIC_APP_URL: "https://app.example.test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ requested: false, reason: "no_secret" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sem base de URL não chama nada — não há host para adivinhar", async () => {
    const fetchImpl = vi.fn();

    const result = await requestMessageWorkerRun({
      env: { CRON_SECRET: "s" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ requested: false, reason: "no_base_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DISABLE_WORKER_KICK=1 desliga o atalho sem desligar o cron", async () => {
    const fetchImpl = vi.fn();

    const result = await requestMessageWorkerRun({
      env: { ...BASE_ENV, DISABLE_WORKER_KICK: "1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ requested: false, reason: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("scheduleMessageWorkerKick", () => {
  it("um `after()` que lança NÃO derruba o webhook", () => {
    const throwingAfter = () => {
      // É o que `after()` faz fora de um escopo de requisição.
      throw new Error("after() was called outside a request scope");
    };

    // Um 500 aqui faria a Z-API e a Meta reentregarem a mensagem: um atalho de
    // latência viraria fonte de trabalho duplicado. O atalho pode falhar; o
    // webhook, não.
    expect(() => scheduleMessageWorkerKick(throwingAfter)).not.toThrow();
  });

  it("agenda a tarefa quando há escopo", () => {
    const scheduled: Array<() => Promise<void>> = [];

    scheduleMessageWorkerKick((task) => scheduled.push(task));

    expect(scheduled).toHaveLength(1);
  });
});

describe("webhooks — quando o worker é acordado", () => {
  it("os dois webhooks só acordam o worker quando o job era NOVO", async () => {
    const fs = await import("node:fs/promises");
    for (const route of [
      "src/app/api/whatsapp/zapi/route.ts",
      "src/app/api/whatsapp/webhook/route.ts",
    ]) {
      const source = await fs.readFile(route, "utf8");
      // A Z-API e a Meta reentregam o mesmo webhook. Sem esta guarda, cada
      // reentrega vira uma invocação de worker (e um toque no banco) sem
      // trabalho nenhum para fazer — exatamente o padrão que esta mudança
      // existe para eliminar.
      expect(source).toMatch(/if \(result\.jobWasNew\) \{\s*scheduleMessageWorkerKick\(after/);
    }
  });
});
