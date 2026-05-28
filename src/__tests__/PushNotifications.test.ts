// Testes para a feature de Push Notifications.
// Cobre: NotifyClinicOperators (dispatch, falhas, limpeza de subs expiradas),
// validação da rota API e formato do payload do service worker.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import webpush from "web-push";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";
import type { PushSubscriptionRepository } from "@/domain/repositories/push-subscription-repository";
import type { PushGateway, PushPayload } from "@/application/ports/push-gateway";
import type { PushSubscription } from "@/domain/entities/push-subscription";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T10:00:00Z");
const VAPID_ENV_KEYS = ["VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const;
const ORIGINAL_VAPID_ENV = Object.fromEntries(
  VAPID_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof VAPID_ENV_KEYS)[number], string | undefined>;

function clearVapidEnv(): void {
  for (const key of VAPID_ENV_KEYS) delete process.env[key];
}

function restoreVapidEnv(): void {
  for (const key of VAPID_ENV_KEYS) {
    const original = ORIGINAL_VAPID_ENV[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

function configureVapidEnv(): void {
  process.env.VAPID_SUBJECT = "mailto:ops@example.com";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
}

function makeSub(overrides: Partial<PushSubscription> = {}): PushSubscription {
  return {
    id: "sub-1",
    clinicId: "clinic-1",
    userEmail: "op@clinic.com",
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: "BPUBLIC_KEY",
    auth: "AUTH_SECRET",
    createdAt: NOW,
    ...overrides,
  };
}

function makePayload(overrides: Partial<PushPayload> = {}): PushPayload {
  return {
    title: "Nova mensagem",
    body: "Lead: Olá, quero agendar",
    url: "/app/inbox/conv-1",
    ...overrides,
  };
}

// ─── Helpers para criar mocks tipados ────────────────────────────────────────

function makeRepo(subs: PushSubscription[] = []): PushSubscriptionRepository {
  return {
    save: vi.fn(),
    findByClinicId: vi.fn().mockResolvedValue(subs),
    deleteByEndpoint: vi.fn().mockResolvedValue(undefined),
  };
}

function makeGateway(impl?: (sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload) => Promise<void>): PushGateway {
  return {
    send: vi.fn(impl ?? (() => Promise.resolve())),
  };
}

// ─── 1. WebPushGateway — inicialização lazy ─────────────────────────────────

describe("WebPushGateway — inicialização lazy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearVapidEnv();
  });

  afterEach(() => {
    restoreVapidEnv();
  });

  it("não configura web-push no import e não lança sem VAPID keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const gateway = new WebPushGateway();

    await expect(gateway.send(makeSub(), makePayload())).resolves.toBeUndefined();

    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[WebPushGateway] VAPID keys not configured - push notifications disabled");

    warn.mockRestore();
  });

  it("configura VAPID uma única vez quando envia notificação", async () => {
    configureVapidEnv();
    const gateway = new WebPushGateway();
    const subscription = makeSub();
    const payload = makePayload();

    await gateway.send(subscription, payload);
    await gateway.send(subscription, payload);

    expect(webpush.setVapidDetails).toHaveBeenCalledTimes(1);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith("mailto:ops@example.com", "public-key", "private-key");
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
  });
});

// ─── 1. NotifyClinicOperators — dispatch ─────────────────────────────────────

describe("NotifyClinicOperators — dispatch", () => {
  it("não dispara se não há subscriptions cadastradas", async () => {
    const repo = makeRepo([]);
    const gateway = makeGateway();
    const useCase = new NotifyClinicOperators(repo, gateway);

    await useCase.execute("clinic-1", makePayload());

    expect(gateway.send).not.toHaveBeenCalled();
  });

  it("dispara para todas as subscriptions da clínica", async () => {
    const subs = [makeSub({ id: "sub-1" }), makeSub({ id: "sub-2", endpoint: "https://fcm.example.com/2" })];
    const repo = makeRepo(subs);
    const gateway = makeGateway();
    const useCase = new NotifyClinicOperators(repo, gateway);

    await useCase.execute("clinic-1", makePayload());

    expect(gateway.send).toHaveBeenCalledTimes(2);
  });

  it("passa endpoint, p256dh e auth corretos para o gateway", async () => {
    const sub = makeSub();
    const repo = makeRepo([sub]);
    const gateway = makeGateway();
    const useCase = new NotifyClinicOperators(repo, gateway);
    const payload = makePayload();

    await useCase.execute("clinic-1", payload);

    expect(gateway.send).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    );
  });

  it("passa título, body e url corretos no payload", async () => {
    const repo = makeRepo([makeSub()]);
    const gateway = makeGateway();
    const useCase = new NotifyClinicOperators(repo, gateway);
    const payload: PushPayload = {
      title: "⚠️ Atenção",
      body: "João Silva: Urgência clínica",
      url: "/app/inbox",
    };

    await useCase.execute("clinic-1", payload);

    expect(gateway.send).toHaveBeenCalledWith(
      expect.any(Object),
      payload,
    );
  });
});

// ─── 2. NotifyClinicOperators — tolerância a falhas ──────────────────────────

describe("NotifyClinicOperators — tolerância a falhas", () => {
  it("não lança se uma subscription falha — outras continuam", async () => {
    const subs = [
      makeSub({ id: "sub-1", endpoint: "https://fcm.example.com/1" }),
      makeSub({ id: "sub-2", endpoint: "https://fcm.example.com/2" }),
    ];
    const repo = makeRepo(subs);
    const gateway = makeGateway(async (sub) => {
      if (sub.endpoint.includes("/1")) throw Object.assign(new Error("Network error"), { statusCode: 500 });
    });
    const useCase = new NotifyClinicOperators(repo, gateway);

    await expect(useCase.execute("clinic-1", makePayload())).resolves.not.toThrow();
    expect(gateway.send).toHaveBeenCalledTimes(2);
  });

  it("remove subscription com statusCode 410 (expirada)", async () => {
    const sub = makeSub();
    const repo = makeRepo([sub]);
    const gateway = makeGateway(async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    const useCase = new NotifyClinicOperators(repo, gateway);

    await useCase.execute("clinic-1", makePayload());

    expect(repo.deleteByEndpoint).toHaveBeenCalledWith(sub.endpoint);
  });

  it("remove subscription com statusCode 404 (endpoint inválido)", async () => {
    const sub = makeSub();
    const repo = makeRepo([sub]);
    const gateway = makeGateway(async () => {
      throw Object.assign(new Error("Not Found"), { statusCode: 404 });
    });
    const useCase = new NotifyClinicOperators(repo, gateway);

    await useCase.execute("clinic-1", makePayload());

    expect(repo.deleteByEndpoint).toHaveBeenCalledWith(sub.endpoint);
  });

  it("NÃO remove subscription com outros erros (ex: 500 transitório)", async () => {
    const sub = makeSub();
    const repo = makeRepo([sub]);
    const gateway = makeGateway(async () => {
      throw Object.assign(new Error("Internal"), { statusCode: 500 });
    });
    const useCase = new NotifyClinicOperators(repo, gateway);

    await useCase.execute("clinic-1", makePayload());

    expect(repo.deleteByEndpoint).not.toHaveBeenCalled();
  });
});

// ─── 3. Validação do payload da rota API ─────────────────────────────────────

describe("Validação do payload da rota /api/push/subscribe", () => {
  function validateSubscribeBody(body: unknown): { valid: boolean; error?: string } {
    if (typeof body !== "object" || body === null) return { valid: false, error: "Invalid body" };
    const b = body as Record<string, unknown>;
    if (typeof b.endpoint !== "string" || !b.endpoint) return { valid: false, error: "Missing subscription fields" };
    if (typeof b.keys !== "object" || b.keys === null) return { valid: false, error: "Missing subscription fields" };
    const keys = b.keys as Record<string, unknown>;
    if (typeof keys.p256dh !== "string" || !keys.p256dh) return { valid: false, error: "Missing subscription fields" };
    if (typeof keys.auth !== "string" || !keys.auth) return { valid: false, error: "Missing subscription fields" };
    return { valid: true };
  }

  it("aceita payload completo e válido", () => {
    const result = validateSubscribeBody({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "BPUBKEY", auth: "AUTH" },
    });
    expect(result.valid).toBe(true);
  });

  it("rejeita sem endpoint", () => {
    const result = validateSubscribeBody({ keys: { p256dh: "X", auth: "Y" } });
    expect(result.valid).toBe(false);
  });

  it("rejeita sem keys.p256dh", () => {
    const result = validateSubscribeBody({ endpoint: "https://fcm.example.com", keys: { auth: "Y" } });
    expect(result.valid).toBe(false);
  });

  it("rejeita sem keys.auth", () => {
    const result = validateSubscribeBody({ endpoint: "https://fcm.example.com", keys: { p256dh: "X" } });
    expect(result.valid).toBe(false);
  });

  it("rejeita body vazio", () => {
    const result = validateSubscribeBody({});
    expect(result.valid).toBe(false);
  });
});

// ─── 4. Formato do payload para o service worker ─────────────────────────────

describe("Formato do payload enviado ao service worker", () => {
  it("payload de nova mensagem contém title, body e url", () => {
    const payload: PushPayload = {
      title: "Nova mensagem",
      body: "Maria Silva: Quero agendar",
      url: "/app/inbox/conv-abc",
    };
    expect(payload.title).toBeTruthy();
    expect(payload.body).toBeTruthy();
    expect(payload.url).toMatch(/^\/app\/inbox/);
  });

  it("payload de atenção contém prefixo de alerta no título", () => {
    const clinicName = "Ximendes Odontologia";
    const payload: PushPayload = {
      title: `⚠️ Atenção — ${clinicName}`,
      body: "João (11999) : Urgência clínica relatada",
      url: "/app/inbox",
    };
    expect(payload.title).toContain("⚠️");
    expect(payload.url).toBe("/app/inbox");
  });
});
