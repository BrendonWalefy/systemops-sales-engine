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
  parseInstitutionalDetails,
} from "@/application/config/institutional-details";
import {
  updateInstitutionalDetails,
} from "@/app/(clinic)/app/settings/playbook/playbook-version-actions";

describe("institutional details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionClinicIdMock.mockResolvedValue(SESSION_CLINIC);
  });

  it("normalizes a valid bounded configuration", () => {
    expect(parseInstitutionalDetails({
      parkingInformation: "  Estacionamento na rua lateral.  ",
      socialChannels: [
        { label: " Instagram ", url: " https://instagram.com/clinic " },
        { label: "YouTube", url: "https://youtube.com/@clinic" },
      ],
    })).toEqual({
      parkingInformation: "Estacionamento na rua lateral.",
      socialChannels: [
        { label: "Instagram", url: "https://instagram.com/clinic" },
        { label: "YouTube", url: "https://youtube.com/@clinic" },
      ],
    });
  });

  it("normalizes empty fields to null", () => {
    expect(parseInstitutionalDetails({
      parkingInformation: "  ",
      socialChannels: [{ label: "", url: "" }],
    })).toEqual({ parkingInformation: null, socialChannels: null });
  });

  it.each([
    ["more than five channels", {
      parkingInformation: null,
      socialChannels: Array.from({ length: 6 }, (_, index) => ({
        label: `Canal ${index}`,
        url: `https://example.com/${index}`,
      })),
    }],
    ["duplicate normalized labels", {
      parkingInformation: null,
      socialChannels: [
        { label: "Instagram", url: "https://instagram.com/a" },
        { label: " instagram ", url: "https://instagram.com/b" },
      ],
    }],
    ["non-https URL", {
      parkingInformation: null,
      socialChannels: [{ label: "Site", url: "http://example.com" }],
    }],
    ["overlong parking", {
      parkingInformation: "x".repeat(241),
      socialChannels: null,
    }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseInstitutionalDetails(input)).toThrow();
  });

  it("updates only the organization resolved from the session", async () => {
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

    await updateInstitutionalDetails({
      parkingInformation: "Vagas ao lado.",
      socialChannels: [{ label: "Instagram", url: "https://instagram.com/clinic" }],
    });

    const rendered = new PgDialect().sqlToQuery(
      whereFragment as Parameters<PgDialect["sqlToQuery"]>[0],
    );
    expect(requireSessionClinicIdMock).toHaveBeenCalledOnce();
    expect(rendered.sql).toContain('"organizations"."id" = $');
    expect(rendered.params).toContain(SESSION_CLINIC);
    expect(written).toMatchObject({
      parkingInformation: "Vagas ao lado.",
      socialChannels: [{ label: "Instagram", url: "https://instagram.com/clinic" }],
    });
  });
});
