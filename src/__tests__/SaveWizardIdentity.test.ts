import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  verifyToken: vi.fn(),
  db: { update: vi.fn() },
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/session", () => ({
  verifyToken: mocks.verifyToken,
  COOKIE_NAME: "sops_session",
}));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));

import { saveWizardIdentity } from "@/app/(owner)/owner/onboarding/[clinicId]/actions";

function baseData(overrides: Partial<Parameters<typeof saveWizardIdentity>[1]> = {}) {
  return {
    specialty: "odontologia",
    city: "São Paulo",
    address: "Rua Teste, 123",
    addressComplement: "",
    mapsUrl: "",
    greetingMessage: "Olá!",
    channelProvider: "z_api" as const,
    zapiInstanceId: "instance-1",
    zapiToken: "",
    zapiClientToken: "",
    metaPhoneNumberId: "",
    metaAccessToken: "",
    ...overrides,
  };
}

describe("saveWizardIdentity", () => {
  let setSpy: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(64);
  });

  afterAll(() => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    mocks.verifyToken.mockResolvedValue({ role: "owner" });
    setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.db.update.mockReturnValue({ set: setSpy });
  });

  it("rejeita quando a sessão não é owner", async () => {
    mocks.verifyToken.mockResolvedValue({ role: "org_admin" });

    const result = await saveWizardIdentity("clinic-1", baseData());

    expect(result).toEqual({ success: false, error: "Sem permissão" });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("NÃO apaga zapiToken/zapiClientToken já salvos quando o campo vem vazio", async () => {
    await saveWizardIdentity("clinic-1", baseData({ zapiToken: "", zapiClientToken: "" }));

    const setArg = setSpy.mock.calls[0][0];
    expect(setArg).not.toHaveProperty("zapiToken");
    expect(setArg).not.toHaveProperty("zapiClientToken");
    expect(setArg).not.toHaveProperty("metaAccessToken");
  });

  it("grava zapiToken criptografado quando o campo vem preenchido", async () => {
    await saveWizardIdentity("clinic-1", baseData({ zapiToken: "novo-token" }));

    const setArg = setSpy.mock.calls[0][0];
    expect(setArg.zapiToken).toBeTypeOf("string");
    expect(setArg.zapiToken).not.toBe("novo-token"); // veio criptografado
  });

  it("sempre grava zapiInstanceId (não é segredo)", async () => {
    await saveWizardIdentity("clinic-1", baseData({ zapiInstanceId: "instance-novo" }));

    const setArg = setSpy.mock.calls[0][0];
    expect(setArg.zapiInstanceId).toBe("instance-novo");
  });
});
