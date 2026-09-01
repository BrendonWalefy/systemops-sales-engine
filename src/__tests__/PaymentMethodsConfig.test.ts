import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const SESSION_CLINIC = "00000000-0000-0000-0000-00000000aaaa";

const dbMock = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const requireSessionClinicIdMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/tenancy/resolve-clinic", () => ({
  requireSessionClinicId: requireSessionClinicIdMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import {
  PAYMENT_METHOD_OPTIONS,
  parsePaymentMethods,
} from "@/application/config/payment-methods";
import { updatePaymentMethods } from "@/app/(clinic)/app/settings/playbook/playbook-version-actions";

describe("structured payment methods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionClinicIdMock.mockResolvedValue(SESSION_CLINIC);
  });

  it("accepts only the closed, ordered method codes exposed by Financeiro", () => {
    expect(PAYMENT_METHOD_OPTIONS).toEqual([
      { code: "pix", label: "Pix" },
      { code: "credit_card", label: "Cartão de crédito" },
      { code: "debit_card", label: "Cartão de débito" },
      { code: "cash", label: "Dinheiro" },
      { code: "bank_transfer", label: "Transferência bancária" },
      { code: "invoice", label: "Boleto" },
    ]);
    expect(parsePaymentMethods([" pix ", "credit_card"])).toEqual([
      "pix",
      "credit_card",
    ]);
  });

  it.each([
    ["unknown", ["crypto"]],
    ["duplicate", ["pix", " pix "]],
    ["not an array", "pix"],
    ["empty code", [""]],
  ])("rejects %s configuration", (_label, value) => {
    expect(() => parsePaymentMethods(value)).toThrow();
  });

  it("writes only the exact tenant resolved from the session", async () => {
    let whereFragment: unknown;
    let written: unknown;
    dbMock.update.mockReturnValue({
      set: vi.fn((value: unknown) => {
        written = value;
        return {
          where: vi.fn((fragment: unknown) => {
            whereFragment = fragment;
            return Promise.resolve();
          }),
        };
      }),
    });

    await updatePaymentMethods(["pix", "credit_card"]);

    const rendered = new PgDialect().sqlToQuery(
      whereFragment as Parameters<PgDialect["sqlToQuery"]>[0],
    );
    expect(requireSessionClinicIdMock).toHaveBeenCalledOnce();
    expect(rendered.sql).toContain('"organizations"."id" = $');
    expect(rendered.params).toContain(SESSION_CLINIC);
    expect(written).toMatchObject({ paymentMethods: ["pix", "credit_card"] });
  });

  it("rejects invalid input before opening a write", async () => {
    await expect(updatePaymentMethods(["pix", "pix"])).rejects.toThrow();
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
