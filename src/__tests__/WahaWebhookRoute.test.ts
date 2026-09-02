import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveClinicByWahaSession = vi.fn();
const persistInboundEventAndEnqueue = vi.fn();
const scheduleMessageWorkerWake = vi.fn();

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  resolveClinicByWahaSession: (...args: unknown[]) => resolveClinicByWahaSession(...args),
}));

vi.mock("@/application/whatsapp/persist-inbound-event", () => ({
  persistInboundEventAndEnqueue: (...args: unknown[]) => persistInboundEventAndEnqueue(...args),
}));

vi.mock("@/application/jobs/worker-wake", () => ({
  scheduleMessageWorkerWake: (...args: unknown[]) => scheduleMessageWorkerWake(...args),
}));

vi.mock("@/infrastructure/repositories/drizzle-inbound-event-store", () => ({
  DrizzleInboundEventStore: class {},
}));

const CLINIC_ID = "11111111-1111-1111-1111-111111111111";

function request(body: unknown, url = "https://app.test/api/whatsapp/waha") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function messageEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "message",
    session: "lab",
    payload: {
      id: "false_5511999999999@c.us_ABC",
      timestamp: 1667561485,
      from: "5511999999999@c.us",
      fromMe: false,
      body: "Oi",
      hasMedia: false,
      ...overrides,
    },
  };
}

async function postWebhook(body: unknown, url?: string) {
  const { POST } = await import("@/app/api/whatsapp/waha/route");
  return POST(request(body, url) as never);
}

beforeEach(() => {
  vi.resetModules();
  resolveClinicByWahaSession.mockReset().mockResolvedValue(CLINIC_ID);
  persistInboundEventAndEnqueue.mockReset().mockResolvedValue({
    outcome: "registered",
    inboundEventId: "evt-1",
    eventWasNew: true,
    jobWasNew: true,
    runAt: new Date(),
  });
  scheduleMessageWorkerWake.mockReset();
  delete process.env.WAHA_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/whatsapp/waha", () => {
  it("enfileira a mensagem recebida para o tenant da sessão", async () => {
    const response = await postWebhook(messageEvent());

    expect(response.status).toBe(200);
    expect(resolveClinicByWahaSession).toHaveBeenCalledWith("lab");
    expect(persistInboundEventAndEnqueue).toHaveBeenCalledTimes(1);

    const [event] = persistInboundEventAndEnqueue.mock.calls[0] as [
      { clinicId: string; provider: string; dedupeKey: string },
    ];
    expect(event.clinicId).toBe(CLINIC_ID);
    expect(event.provider).toBe("waha");
    expect(event.dedupeKey).toBe("waha:lab:false_5511999999999@c.us_ABC");
  });

  it("acorda o worker quando o job é novo, em vez de esperar o cron", async () => {
    await postWebhook(messageEvent());

    expect(scheduleMessageWorkerWake).toHaveBeenCalledTimes(1);
  });

  it("recusa a mensagem quando a sessão não pertence a nenhuma organização", async () => {
    resolveClinicByWahaSession.mockResolvedValue(null);

    const response = await postWebhook(messageEvent());

    expect(response.status).toBe(500);
    expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("ignora mensagem de grupo", async () => {
    const response = await postWebhook(messageEvent({ from: "12036304@g.us" }));

    expect(response.status).toBe(200);
    expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("ignora o echo das próprias mensagens enviadas (fromMe)", async () => {
    const response = await postWebhook(messageEvent({ fromMe: true }));

    expect(response.status).toBe(200);
    expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("ignora eventos que não são de mensagem", async () => {
    const response = await postWebhook({ event: "session.status", session: "lab", payload: {} });

    expect(response.status).toBe(200);
    expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("rejeita payload sem id de mensagem", async () => {
    const response = await postWebhook(messageEvent({ id: "" }));

    expect(response.status).toBe(400);
    expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("devolve 500 quando a persistência falha, para o WAHA reentregar", async () => {
    persistInboundEventAndEnqueue.mockRejectedValue(new Error("db down"));

    const response = await postWebhook(messageEvent());

    expect(response.status).toBe(500);
  });

  describe("autenticação de origem", () => {
    it("rejeita sem o secret quando WAHA_WEBHOOK_SECRET está definido", async () => {
      process.env.WAHA_WEBHOOK_SECRET = "s3cr3t";

      const response = await postWebhook(messageEvent());

      expect(response.status).toBe(401);
      expect(persistInboundEventAndEnqueue).not.toHaveBeenCalled();
    });

    it("aceita com o secret correto na query", async () => {
      process.env.WAHA_WEBHOOK_SECRET = "s3cr3t";

      const response = await postWebhook(
        messageEvent(),
        "https://app.test/api/whatsapp/waha?secret=s3cr3t",
      );

      expect(response.status).toBe(200);
      expect(persistInboundEventAndEnqueue).toHaveBeenCalledTimes(1);
    });

    it("rejeita secret errado", async () => {
      process.env.WAHA_WEBHOOK_SECRET = "s3cr3t";

      const response = await postWebhook(
        messageEvent(),
        "https://app.test/api/whatsapp/waha?secret=errado",
      );

      expect(response.status).toBe(401);
    });
  });
});
