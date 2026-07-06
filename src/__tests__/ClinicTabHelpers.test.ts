/**
 * Testes para os helpers puros de tab e CTA da página da clínica (ADR-006 Fase A).
 */

import { describe, expect, it } from "vitest";
import { resolveDefaultTab, resolveContextualCta } from "@/app/(owner)/owner/clinics/[clinicId]/clinic-tab-helpers";


// ---------- resolveDefaultTab ----------

describe("resolveDefaultTab", () => {
  it("retorna 'operacao' para clínicas com status active", () => {
    expect(resolveDefaultTab("active")).toBe("operacao");
  });

  it("retorna 'implantacao' para clínicas prospect", () => {
    expect(resolveDefaultTab("prospect")).toBe("implantacao");
  });

  it("retorna 'implantacao' para clínicas shadow", () => {
    expect(resolveDefaultTab("shadow")).toBe("implantacao");
  });

  it("retorna 'implantacao' para clínicas cancelled (arquivadas)", () => {
    expect(resolveDefaultTab("cancelled")).toBe("implantacao");
  });
});

// ---------- resolveContextualCta ----------

const BASE = {
  clinicId: "clinic-123",
  channelPairedAt: null as Date | null,
  shadowModeEnabled: false,
  operationalStatus: "prospect",
};

describe("resolveContextualCta", () => {
  it("retorna 'Conectar WhatsApp' quando sem channel pareado", () => {
    const cta = resolveContextualCta({ ...BASE });
    expect(cta.label).toBe("Conectar WhatsApp");
    expect(cta.kind).toBe("link");
    if (cta.kind === "link") {
      expect(cta.href).toContain("onboarding/clinic-123");
    }
  });

  it("retorna 'Ver implantação' quando pareado e shadow ligado", () => {
    const cta = resolveContextualCta({
      ...BASE,
      channelPairedAt: new Date("2026-01-01"),
      shadowModeEnabled: true,
    });
    expect(cta.label).toBe("Ver implantação");
    expect(cta.kind).toBe("tab");
    if (cta.kind === "tab") {
      expect(cta.tab).toBe("implantacao");
    }
  });

  it("retorna 'Conectar WhatsApp' quando pareado mas shadow desligado e não active", () => {
    const cta = resolveContextualCta({
      ...BASE,
      channelPairedAt: new Date("2026-01-01"),
      shadowModeEnabled: false,
    });
    expect(cta.label).toBe("Conectar WhatsApp");
  });

  it("retorna 'Inbox' quando operationalStatus é active", () => {
    const cta = resolveContextualCta({
      ...BASE,
      operationalStatus: "active",
    });
    expect(cta.label).toBe("Inbox");
    expect(cta.kind).toBe("link");
    if (cta.kind === "link") {
      expect(cta.href).toBe("/app/inbox");
    }
  });

  it("'Inbox' tem prioridade mesmo se shadow ligado", () => {
    const cta = resolveContextualCta({
      ...BASE,
      operationalStatus: "active",
      channelPairedAt: new Date("2026-01-01"),
      shadowModeEnabled: true,
    });
    expect(cta.label).toBe("Inbox");
  });
});
