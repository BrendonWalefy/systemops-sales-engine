import { describe, expect, it } from "vitest";
import { selectUnambiguousDefaultProfessionalId } from "@/application/calendar/resolve-default-professional";

describe("selectUnambiguousDefaultProfessionalId", () => {
  it("seleciona o único profissional ativo disponível", () => {
    expect(selectUnambiguousDefaultProfessionalId([{ id: "professional-1" }])).toBe(
      "professional-1",
    );
  });

  it("não escolhe por nome quando há mais de um profissional", () => {
    expect(
      selectUnambiguousDefaultProfessionalId([
        { id: "professional-1" },
        { id: "professional-2" },
      ]),
    ).toBeNull();
  });

  it("retorna null quando não há profissional ativo", () => {
    expect(selectUnambiguousDefaultProfessionalId([])).toBeNull();
  });
});
