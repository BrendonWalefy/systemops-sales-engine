/**
 * Testes para os builders da camada de aplicação do Setup Study.
 * (buildCorpus e extractFindings com parse defensivo)
 */

import { describe, expect, it } from "vitest";
import { parseFindings } from "@/application/setup-study/extract-findings";
import { anonymizeText } from "@/application/setup-study/build-corpus";

describe("anonymizeText", () => {
  it("substitui o nome do lead corretamente (case insensitive)", () => {
    const text = "Olá, João Silva! Tudo bem?";
    expect(anonymizeText(text, "joão silva")).toBe("Olá, [PACIENTE]! Tudo bem?");
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
