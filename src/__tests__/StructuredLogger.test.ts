import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "@/infrastructure/logging/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger — logging estruturado em JSON de linha única", () => {
  it("emite JSON com contexto fixo e nível info", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger({ scope: "Test", correlationId: "msg-1", clinicId: "clinic-1" });

    log.info("evento", { intent: "greeting" });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: "info",
      msg: "evento",
      scope: "Test",
      correlationId: "msg-1",
      clinicId: "clinic-1",
      intent: "greeting",
    });
    expect(parsed.ts).toBeTruthy();
  });

  it("error serializa Error com mensagem e stack truncado", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger({ scope: "Test" });

    log.error("falhou", new Error("boom"), { partIndex: 2 });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.errorMessage).toBe("boom");
    expect(parsed.errorName).toBe("Error");
    expect(parsed.partIndex).toBe(2);
  });

  it("error aceita valores não-Error sem quebrar", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger({ scope: "Test" });

    log.error("falhou", "string crua");

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.errorMessage).toBe("string crua");
  });

  it("child herda contexto e adiciona campos", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger({ scope: "Test", clinicId: "clinic-1" });
    const child = log.child({ conversationId: "conv-9" });

    child.warn("aviso");

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.clinicId).toBe("clinic-1");
    expect(parsed.conversationId).toBe("conv-9");
  });

  it("preserva os identificadores de execução durável", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger({
      scope: "Worker",
      traceId: "outbound-1",
      jobId: "job-1",
      queue: "message.send",
      workerId: "sender-1",
      route: "/api/cron/sender-worker",
    });

    log.info("job.sent", { durationMs: 42 });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      traceId: "outbound-1",
      jobId: "job-1",
      queue: "message.send",
      workerId: "sender-1",
      route: "/api/cron/sender-worker",
      durationMs: 42,
    });
  });
});
