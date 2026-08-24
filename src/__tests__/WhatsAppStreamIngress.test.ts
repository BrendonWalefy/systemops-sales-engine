import { describe, expect, it } from "vitest";
import * as identity from "@/core/whatsapp/WhatsAppContactIdentity";

type Alias = Readonly<{
  kind: "phone" | "whatsapp_lid" | "provider_thread";
  providerScope: string;
  normalizedValue: string;
}>;

type BuildAliases = (input: Readonly<{
  provider: "meta_cloud_api" | "z_api";
  providerInstanceId: string;
  providerThreadId: string;
  phone?: string | null;
  whatsappLid?: string | null;
}>) => readonly Alias[];

function buildAliases(): BuildAliases {
  const candidate = (identity as Record<string, unknown>).buildWhatsAppStreamAliases;
  expect(candidate, "buildWhatsAppStreamAliases must be exported").toBeTypeOf("function");
  return candidate as BuildAliases;
}

describe("WhatsApp stream alias normalization", () => {
  it("normalizes phone, LID, and a Z-API provider thread into enforceable scopes", () => {
    expect(buildAliases()({
      provider: "z_api",
      providerInstanceId: "  instance-A  ",
      providerThreadId: "  thread-A  ",
      phone: "+55 (11) 99999-9999",
      whatsappLid: "  271295921025045@LID  ",
    })).toEqual([
      {
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511999999999",
      },
      {
        kind: "whatsapp_lid",
        providerScope: "__provider_independent__",
        normalizedValue: "271295921025045@lid",
      },
      {
        kind: "provider_thread",
        providerScope: "z_api:instance-A",
        normalizedValue: "thread-A",
      },
    ]);
  });

  it("uses the Meta phone-number id as the provider scope", () => {
    expect(buildAliases()({
      provider: "meta_cloud_api",
      providerInstanceId: "123456789",
      providerThreadId: "5511888888888",
      phone: "5511888888888",
    })).toEqual([
      {
        kind: "phone",
        providerScope: "__provider_independent__",
        normalizedValue: "5511888888888",
      },
      {
        kind: "provider_thread",
        providerScope: "meta_cloud_api:123456789",
        normalizedValue: "5511888888888",
      },
    ]);
  });

  it("fails closed when provider instance or thread identity is missing", () => {
    expect(() => buildAliases()({
      provider: "z_api",
      providerInstanceId: " ",
      providerThreadId: "thread-A",
      phone: "5511999999999",
    })).toThrow("provider instance identity is required");
    expect(() => buildAliases()({
      provider: "z_api",
      providerInstanceId: "instance-A",
      providerThreadId: " ",
      phone: "5511999999999",
    })).toThrow("provider thread identity is required");
  });

  it("omits invalid contact aliases while retaining the durable provider thread", () => {
    expect(buildAliases()({
      provider: "z_api",
      providerInstanceId: "instance-A",
      providerThreadId: "thread-A",
      phone: "invalid",
      whatsappLid: "not-a-lid",
    })).toEqual([{
      kind: "provider_thread",
      providerScope: "z_api:instance-A",
      normalizedValue: "thread-A",
    }]);
  });
});
