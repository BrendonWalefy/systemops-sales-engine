import { describe, expect, it } from "vitest";
import { pickDefaultProfessional } from "@/application/calendar/resolve-default-professional";

// A regra é intencionalmente cega ao nome do profissional: o parâmetro só
// aceita { id, isActive }. Isso torna estruturalmente impossível reintroduzir
// o viés antigo (favorecer alguém pelo nome, como "victor"), que quebrava o
// isolamento multi-tenant assim que outra clínica cadastrasse um profissional
// com o mesmo pedaço de nome.
describe("pickDefaultProfessional", () => {
  it("returns null when no professionals are cadastrados", () => {
    expect(pickDefaultProfessional([])).toBeNull();
  });

  it("returns the id of the sole active professional", () => {
    expect(pickDefaultProfessional([{ id: "p-1", isActive: true }])).toBe("p-1");
  });

  it("returns null when the only professional is inactive", () => {
    expect(pickDefaultProfessional([{ id: "p-1", isActive: false }])).toBeNull();
  });

  it("returns null when several active professionals exist (ambiguous)", () => {
    expect(
      pickDefaultProfessional([
        { id: "p-1", isActive: true },
        { id: "p-2", isActive: true },
      ]),
    ).toBeNull();
  });

  it("ignores inactive professionals when counting the single active one", () => {
    expect(
      pickDefaultProfessional([
        { id: "p-old-1", isActive: false },
        { id: "p-active", isActive: true },
        { id: "p-old-2", isActive: false },
      ]),
    ).toBe("p-active");
  });

  it("never returns an inactive professional, even when listed first", () => {
    expect(
      pickDefaultProfessional([
        { id: "p-inactive", isActive: false },
        { id: "p-active", isActive: true },
      ]),
    ).toBe("p-active");
  });

  it("returns null even when only inactive professionals exist", () => {
    expect(
      pickDefaultProfessional([
        { id: "p-1", isActive: false },
        { id: "p-2", isActive: false },
      ]),
    ).toBeNull();
  });
});
