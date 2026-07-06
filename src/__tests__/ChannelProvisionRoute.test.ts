import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  verifyToken: vi.fn(),
  db: {
    query: { organizations: { findFirst: vi.fn() } },
    update: vi.fn(),
  },
  createZApiInstance: vi.fn(),
  applyZApiInstancePreset: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/session", () => ({
  verifyToken: mocks.verifyToken,
  COOKIE_NAME: "sops_session",
}));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter", () => ({
  createZApiInstance: mocks.createZApiInstance,
  applyZApiInstancePreset: mocks.applyZApiInstancePreset,
}));

import { POST } from "@/app/api/owner/clinics/[clinicId]/channel-provision/route";

const ENV_KEYS = ["ZAPI_PARTNER_TOKEN", "ZAPI_ACCOUNT_CLIENT_TOKEN"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function request(): NextRequest {
  return new NextRequest("http://systemops.test/api/owner/clinics/clinic-1/channel-provision", {
    method: "POST",
  });
}

function ctx(clinicId = "clinic-1") {
  return { params: Promise.resolve({ clinicId }) };
}

describe("POST /api/owner/clinics/[clinicId]/channel-provision", () => {
  let setSpy: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(64);
  });

  afterAll(() => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv();
    process.env.ZAPI_PARTNER_TOKEN = "partner-token-abc";
    delete process.env.ZAPI_ACCOUNT_CLIENT_TOKEN;

    mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    mocks.verifyToken.mockResolvedValue({ role: "owner" });
    mocks.db.query.organizations.findFirst.mockResolvedValue({
      id: "clinic-1",
      name: "Clínica Teste",
      zapiInstanceId: null,
    });
    setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.db.update.mockReturnValue({ set: setSpy });
    mocks.createZApiInstance.mockResolvedValue({ instanceId: "instance-1", token: "instance-token", due: 123 });
    mocks.applyZApiInstancePreset.mockResolvedValue(undefined);
  });

  it("rejeita quem não é owner", async () => {
    mocks.verifyToken.mockResolvedValue({ role: "org_admin" });

    const res = await POST(request(), ctx());

    expect(res.status).toBe(401);
    expect(mocks.createZApiInstance).not.toHaveBeenCalled();
  });

  it("recusa provisionar de novo quando a clínica já tem instância", async () => {
    mocks.db.query.organizations.findFirst.mockResolvedValue({
      id: "clinic-1",
      name: "Clínica Teste",
      zapiInstanceId: "instance-existente",
    });

    const res = await POST(request(), ctx());

    expect(res.status).toBe(409);
    expect(mocks.createZApiInstance).not.toHaveBeenCalled();
  });

  it("cria a instância, salva credenciais criptografadas e NÃO devolve token/clientToken ao client", async () => {
    const res = await POST(request(), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, instanceId: "instance-1", due: 123, presetWarning: undefined });
    expect(json.token).toBeUndefined();
    expect(json.clientToken).toBeUndefined();

    const setArg = setSpy.mock.calls[0][0];
    expect(setArg.zapiInstanceId).toBe("instance-1");
    expect(setArg.zapiToken).not.toBe("instance-token"); // criptografado
    expect(setArg.zapiToken).toContain("enc:");
  });

  it("usa ZAPI_ACCOUNT_CLIENT_TOKEN (não ZAPI_PARTNER_TOKEN) para o Client-Token da conta quando definida", async () => {
    process.env.ZAPI_ACCOUNT_CLIENT_TOKEN = "account-client-token-xyz";

    await POST(request(), ctx());

    expect(mocks.applyZApiInstancePreset).toHaveBeenCalledWith(
      expect.objectContaining({ clientToken: "account-client-token-xyz" }),
    );
  });

  it("responde 500 quando ZAPI_PARTNER_TOKEN não está configurado", async () => {
    delete process.env.ZAPI_PARTNER_TOKEN;

    const res = await POST(request(), ctx());

    expect(res.status).toBe(500);
    expect(mocks.createZApiInstance).not.toHaveBeenCalled();
  });

  it("propaga presetWarning quando o preset falha, mas mantém as credenciais salvas", async () => {
    mocks.applyZApiInstancePreset.mockRejectedValue(new Error("update-filters failed"));

    const res = await POST(request(), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.presetWarning).toBe("update-filters failed");
    expect(mocks.db.update).toHaveBeenCalled();
  });
});
