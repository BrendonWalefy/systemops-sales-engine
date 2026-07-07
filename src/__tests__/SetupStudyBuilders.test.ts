/**
 * Testes para os builders da camada de aplicação do Setup Study.
 * (buildCorpus e extractFindings com parse defensivo)
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { parseFindings, extractFindings } from "@/application/setup-study/extract-findings";
import { anonymizeText } from "@/application/setup-study/build-corpus";

vi.mock("@/infrastructure/llm/advisor-llm", () => ({
  callAdvisorLLM: vi.fn(),
  SETUP_STUDY_MODEL: "claude-test",
}));

import { callAdvisorLLM } from "@/infrastructure/llm/advisor-llm";

describe("anonymizeText", () => {
  it("substitui o nome do lead corretamente (case insensitive)", () => {
    const text = "Olá, João Silva! Tudo bem?";
    expect(anonymizeText(text, "joão silva")).toBe("Olá, [PACIENTE]! Tudo bem?");
  });

  it("substitui partes isoladas do nome (primeiro nome no vocativo)", () => {
    const text = "Boa noite, Cintia. Tudo bem?";
    expect(anonymizeText(text, "Cintia Iorio")).toBe("Boa noite, [PACIENTE]. Tudo bem?");
  });

  it("não substitui partículas de nomes compostos (de/da/dos)", () => {
    const text = "O valor da avaliação depende dos exames.";
    expect(anonymizeText(text, "Maria da Silva dos Santos")).toBe(text);
  });

  it("substitui números de telefone", () => {
    expect(anonymizeText("Meu número é 11987654321", null))
      .toBe("Meu número é [TELEFONE]");
      
    expect(anonymizeText("Pode ligar no (11) 98765-4321", null))
      .toBe("Pode ligar no [TELEFONE]");
  });

  it("mantém o texto original se não houver sensitivos", () => {
    const text = "Qual o valor da consulta?";
    expect(anonymizeText(text, "Maria")).toBe(text);
  });
});

describe("parseFindings", () => {
  it("descarta findings com claim vazio", () => {
    const raw = {
      findings: [
        { claim: " ", evidence: "..." },
        { claim: "Problema real", evidence: "..." }
      ]
    };
    const parsed = parseFindings(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].claim).toBe("Problema real");
  });

  it("anula proposedChange se target não está na allowlist", () => {
    const raw = {
      findings: [
        {
          claim: "Algo",
          evidence: "Algo",
          category: "price",
          severity: 2,
          proposedChange: { target: "invalid.target", newValue: "100", currentValue: "50" }
        }
      ]
    };
    const parsed = parseFindings(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].proposedChange).toBeNull();
  });

  it("aceita proposedChange com target válido", () => {
    const raw = {
      findings: [
        {
          claim: "Algo",
          evidence: "Algo",
          category: "price",
          severity: 2,
          proposedChange: { target: "playbook.toneOfVoice", newValue: "formal", currentValue: "casual" }
        }
      ]
    };
    const parsed = parseFindings(raw);
    expect(parsed[0].proposedChange).not.toBeNull();
    expect(parsed[0].proposedChange?.target).toBe("playbook.toneOfVoice");
  });
});

describe("extractFindings", () => {
  const transcript = {
    clinicId: "c1",
    periodStart: new Date("2026-07-01"),
    periodEnd: new Date("2026-07-07"),
    conversationCount: 1,
    totalMessages: 2,
    text: "PACIENTE: oi\nCLINICA: olá",
  };

  afterEach(() => {
    vi.mocked(callAdvisorLLM).mockReset();
  });

  it("lança erro quando a resposta é JSON truncado/inválido (não salva estudo vazio)", async () => {
    vi.mocked(callAdvisorLLM).mockResolvedValue('{"findings": [{"claim": "Preço da avaliação"}');
    await expect(extractFindings(transcript)).rejects.toThrow(/JSON inválido/);
  });

  it("lança erro quando a resposta não contém JSON", async () => {
    vi.mocked(callAdvisorLLM).mockResolvedValue("Desculpe, não consegui analisar.");
    await expect(extractFindings(transcript)).rejects.toThrow(/não contém JSON/);
  });

  it("extrai findings de resposta com JSON cercado de texto", async () => {
    vi.mocked(callAdvisorLLM).mockResolvedValue(
      'Aqui está:\n```json\n{"findings": [{"claim": "Avaliação custa R$ 150", "evidence": "CLINICA: R$ 150", "category": "price", "severity": 3, "proposedChange": null}]}\n```',
    );
    const findings = await extractFindings(transcript);
    expect(findings).toHaveLength(1);
    expect(findings[0].claim).toBe("Avaliação custa R$ 150");
  });

  it("inclui o catálogo de tratamentos no prompt quando fornecido", async () => {
    vi.mocked(callAdvisorLLM).mockResolvedValue('{"findings": []}');
    await extractFindings(transcript, {
      treatments: [{ id: "11111111-1111-1111-1111-111111111111", name: "Clareamento", priceCents: 80000 }],
    });
    const prompt = vi.mocked(callAdvisorLLM).mock.calls[0][0];
    expect(prompt).toContain("11111111-1111-1111-1111-111111111111 — Clareamento");
    expect(prompt).toContain("R$ 800,00");
  });
});
