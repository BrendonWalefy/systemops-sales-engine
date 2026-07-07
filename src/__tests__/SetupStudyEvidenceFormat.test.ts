import { describe, it, expect } from "vitest";
import { parseEvidenceSegments } from "../application/setup-study/format-evidence";

describe("SetupStudyEvidenceFormat", () => {
  it("should parse multi-segment with different roles", () => {
    const evidence = "CLINICA: R$1.700 / PACIENTE: O valor para 10 lentes? / IA(shadow): Isso mesmo.";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ role: "clinica", text: "R$1.700" });
    expect(segments[1]).toEqual({ role: "paciente", text: "O valor para 10 lentes?" });
    expect(segments[2]).toEqual({ role: "ia", text: "Isso mesmo." });
  });

  it("should parse consecutive segments of the same role", () => {
    const evidence = "CLINICA: R$1.700 / CLINICA: O valor para 10 lentes superiores é R$1.700,00 / CLINICA: + o valor da remoção";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ role: "clinica", text: "R$1.700" });
    expect(segments[1]).toEqual({ role: "clinica", text: "O valor para 10 lentes superiores é R$1.700,00" });
    expect(segments[2]).toEqual({ role: "clinica", text: "+ o valor da remoção" });
  });

  it("should parse IA(shadow) correctly (parentheses in regex)", () => {
    const evidence = "IA(shadow): Resposta da IA / SISTEMA: log";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ role: "ia", text: "Resposta da IA" });
    expect(segments[1]).toEqual({ role: "sistema", text: "log" });
  });

  it("should return fallback role: null if no label is present", () => {
    const evidence = "Apenas uma frase qualquer sem rótulo";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ role: null, text: "Apenas uma frase qualquer sem rótulo" });
  });

  it("should preserve slashes that are not separators", () => {
    const evidence = "CLINICA: R$ 1.700 / arcada";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ role: "clinica", text: "R$ 1.700 / arcada" });
  });

  it("should parse labels in the middle of text without slash before", () => {
    const evidence = "CLINICA: oi PACIENTE: olá";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ role: "clinica", text: "oi" });
    expect(segments[1]).toEqual({ role: "paciente", text: "olá" });
  });

  it("should handle empty segments by discarding them and returning fallback if all empty", () => {
    const evidence = "CLINICA: / PACIENTE: / ";
    const segments = parseEvidenceSegments(evidence);
    
    expect(segments).toHaveLength(1);
    expect(segments[0].role).toBeNull();
  });
});
