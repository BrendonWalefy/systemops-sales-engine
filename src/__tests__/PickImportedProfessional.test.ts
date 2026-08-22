import { describe, expect, it } from "vitest";
import { pickProfessionalForImportedEvent } from "@/application/calendar/import-calendar-events";

// A regra é a mesma classe de defeito já fechada em resolve-default-professional.ts:
// profissional que deixou a clínica (isActive = false) não pode ser casado a
// partir do texto livre do evento do Google Calendar — nem numa consulta nova,
// nem quando o importador atualiza uma consulta já existente. O parâmetro é uma
// lista simples { id, name, isActive } para que a regra seja exercitada sem banco.
describe("pickProfessionalForImportedEvent", () => {
  it("retorna null quando nenhum profissional está cadastrado", () => {
    expect(pickProfessionalForImportedEvent("Paciente consulta rocha", [])).toBeNull();
  });

  it("casa o profissional ativo mencionado no texto do evento", () => {
    const id = pickProfessionalForImportedEvent("Paciente consulta rocha", [
      { id: "p-1", name: "Dr. Rocha", isActive: true },
    ]);
    expect(id).toBe("p-1");
  });

  it("ignora profissional inativo mesmo quando o texto cita o nome dele", () => {
    const id = pickProfessionalForImportedEvent("Paciente consulta rocha", [
      { id: "p-1", name: "Dr. Rocha", isActive: false },
    ]);
    expect(id).toBeNull();
  });

  it("com homônimos ativo e inativo, prefere o ativo", () => {
    const id = pickProfessionalForImportedEvent("Paciente consulta rocha", [
      { id: "p-inactive", name: "Dr. Rocha", isActive: false },
      { id: "p-active", name: "Dr. Rocha", isActive: true },
    ]);
    expect(id).toBe("p-active");
  });

  it("retorna null quando o texto não menciona nenhum profissional cadastrado", () => {
    const id = pickProfessionalForImportedEvent("Paciente limpeza", [
      { id: "p-1", name: "Dr. Rocha", isActive: true },
    ]);
    expect(id).toBeNull();
  });

  it("comportamento inalterado quando todos os candidatos estão ativos", () => {
    const id = pickProfessionalForImportedEvent("Paciente 20 lentes marques", [
      { id: "p-1", name: "Dr. Rocha", isActive: true },
      { id: "p-2", name: "Dra. Marques", isActive: true },
    ]);
    expect(id).toBe("p-2");
  });

  it("normaliza o prefixo Dr./Dra. do cadastro contra o texto do evento", () => {
    // O SUMMARY real menciona só o núcleo do nome ("consulta rocha"), nunca
    // "Dr. Rocha" com prefixo — o cadastro tem o prefixo, o texto não.
    const id = pickProfessionalForImportedEvent("Paciente consulta rocha", [
      { id: "p-1", name: "Dra. Rocha", isActive: true },
    ]);
    expect(id).toBe("p-1");
  });
});
