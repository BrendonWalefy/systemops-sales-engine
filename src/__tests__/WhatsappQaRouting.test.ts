import { describe, expect, it } from "vitest";
import {
  normalizeWhatsappRoutePhone,
  resolveZapiClinicRouteFromRows,
} from "@/application/tenancy/resolve-clinic";

describe("WhatsApp QA routing", () => {
  it("normaliza telefone para E.164 apenas com dígitos", () => {
    expect(normalizeWhatsappRoutePhone("+55 (11) 95362-8848")).toBe("5511953628848");
    expect(normalizeWhatsappRoutePhone(" 5511954368563 ")).toBe("5511954368563");
    expect(normalizeWhatsappRoutePhone(null)).toBeNull();
  });

  it("sem rota QA mantém clínica fonte como clínica lógica e canal", () => {
    const result = resolveZapiClinicRouteFromRows({
      sourceClinicId: "ximendes",
      route: null,
    });

    expect(result).toEqual({
      clinicId: "ximendes",
      channelClinicId: "ximendes",
      sourceClinicId: "ximendes",
      isQaRoute: false,
      routeLabel: null,
    });
  });

  it("rota QA ativa envia conversa para a clínica alvo mantendo canal na fonte", () => {
    const result = resolveZapiClinicRouteFromRows({
      sourceClinicId: "ximendes",
      route: {
        sourceClinicId: "ximendes",
        targetClinicId: "bw-odontologia",
        label: "lead testes",
        enabled: true,
      },
    });

    expect(result).toEqual({
      clinicId: "bw-odontologia",
      channelClinicId: "ximendes",
      sourceClinicId: "ximendes",
      isQaRoute: true,
      routeLabel: "lead testes",
    });
  });

  it("rota desligada não desvia lead da clínica fonte", () => {
    const result = resolveZapiClinicRouteFromRows({
      sourceClinicId: "ximendes",
      route: {
        sourceClinicId: "ximendes",
        targetClinicId: "bw-odontologia",
        label: "lead testes",
        enabled: false,
      },
    });

    expect(result?.clinicId).toBe("ximendes");
    expect(result?.channelClinicId).toBe("ximendes");
    expect(result?.isQaRoute).toBe(false);
  });

  it("rota de outra fonte é ignorada por segurança", () => {
    const result = resolveZapiClinicRouteFromRows({
      sourceClinicId: "ximendes",
      route: {
        sourceClinicId: "outra-clinica",
        targetClinicId: "bw-odontologia",
        label: "lead testes",
        enabled: true,
      },
    });

    expect(result?.clinicId).toBe("ximendes");
    expect(result?.channelClinicId).toBe("ximendes");
    expect(result?.isQaRoute).toBe(false);
  });
});
