import { describe, expect, it } from "vitest";
import {
  isAuthorizedCronRequest,
  normalizeCronAuthorizationHeader,
} from "@/app/api/cron/_auth";

describe("Cron auth helpers", () => {
  it("normaliza token Bearer", () => {
    expect(normalizeCronAuthorizationHeader("Bearer secret")).toBe("secret");
  });

  it("aceita token cru para manter compatibilidade com chamadas manuais", () => {
    expect(normalizeCronAuthorizationHeader("secret")).toBe("secret");
  });

  it("trata Bearer vazio como ausente", () => {
    expect(normalizeCronAuthorizationHeader("Bearer   ")).toBeNull();
  });

  it("autoriza quando Authorization usa o mesmo CRON_SECRET", () => {
    expect(isAuthorizedCronRequest("Bearer secret", "secret")).toBe(true);
  });

  it("nega quando o segredo do cliente diverge", () => {
    expect(isAuthorizedCronRequest("Bearer wrong", "secret")).toBe(false);
  });

  it("nega quando o segredo do servidor nao esta configurado", () => {
    expect(isAuthorizedCronRequest("Bearer secret", undefined)).toBe(false);
  });
});
