// Consulta importada do Google Calendar precisa gravar o tratamento.
//
// A regra anterior comparava o texto do evento com o NOME COMPLETO do
// tratamento. A agenda real não escreve assim:
//
//   "Kevin Manutenção"          x  "Manutenção Preventiva de lentes"
//   "Ana Julia 20 lentes"       x  "Lentes em Resina Composta"
//   "Keyla remoção 20 lentes"   x  "Remoção de lentes"
//
// Medido em produção (Vitalli, 21/07): **0 de 44** eventos importados tinham
// `treatmentId`. Como as regras de pós-atendimento filtram por tratamento, elas
// nunca encontravam ninguém — nenhuma mensagem de cuidados pós-lentes jamais
// saiu. Ver docs/product/plano-correcao-conversacional.md item #20.
//
// As descrições e os tratamentos abaixo são os reais do banco.

import { describe, expect, it } from "vitest";
import {
  matchImportedTreatment,
  type ImportTreatmentCandidate,
} from "@/application/calendar/import-calendar-events";

// Catálogo real da Vitalli (recorte com os que aparecem na agenda).
const VITALLI: ImportTreatmentCandidate[] = [
  {
    id: "composta",
    name: "Lentes em Resina Composta",
    aliases: ["lentes", "lente", "lentes em resina", "facetas", "faceta", "sorriso", "resina"],
  },
  {
    id: "premium",
    name: "Lente em Resina Premium",
    aliases: ["lentes", "resina", "simplificada", "premium", "lente premium"],
  },
  {
    id: "estratificada",
    name: "Lente em Resina Estratificada",
    aliases: ["lentes", "resina", "estratificada", "policromatica", "multicamada"],
  },
  {
    id: "manutencao",
    name: "Manutenção Preventiva de lentes",
    aliases: ["manutenção", "polimento", "limpar lentes", "garantia"],
  },
  {
    id: "remocao",
    name: "Remoção de lentes",
    aliases: ["remover lentes", "tirar facetas", "retirar lentes"],
  },
  {
    id: "avaliacao",
    name: "Avaliação Clínica Inicial",
    aliases: ["avaliação", "consulta inicial", "quero marcar"],
  },
  {
    id: "gengival",
    name: "Plástica Gengival",
    aliases: ["plastica gengival", "gengivoplastia", "sorriso gengival"],
  },
];

describe("matchImportedTreatment — casos reais da agenda", () => {
  it.each([
    ["Kevin Manutenção", "manutencao"],
    ["Manutenção Fabio", "manutencao"],
    ["Laís Manutenção R$400", "manutencao"],
    ["Angelucia 8:30 manutenção 200$", "manutencao"],
    ["Vitor manutenção gratuita", "manutencao"],
    ["Vilma avaliação gregorie", "avaliacao"],
  ])("resolve %s", (summary, expectedId) => {
    expect(matchImportedTreatment(summary, VITALLI).treatmentId).toBe(expectedId);
  });

  it("o nome completo continua funcionando quando aparece por extenso", () => {
    expect(matchImportedTreatment("Joana Plástica Gengival", VITALLI).treatmentId).toBe("gengival");
  });

  it("pontuação grudada não atrapalha", () => {
    // "Priscila lentes / pagou 100$" — barra e cifrão colados nas palavras.
    expect(matchImportedTreatment("Angelucia 8:30 manutenção 200$", VITALLI).treatmentId).toBe("manutencao");
  });
});

describe("ambiguidade não é chutada — isto grava prontuário", () => {
  it("'20 lentes' empata entre as três técnicas e NÃO resolve", () => {
    // 24 dos 44 eventos reais têm essa forma. O texto não diz a técnica; supor
    // uma escreveria a informação errada no prontuário só para a automação
    // disparar.
    const match = matchImportedTreatment("Ana Julia 20 lentes", VITALLI);
    expect(match.treatmentId).toBeNull();
    expect(match.ambiguousWith).toEqual([
      "Lentes em Resina Composta",
      "Lente em Resina Premium",
      "Lente em Resina Estratificada",
    ]);
  });

  it("a técnica escrita no evento desempata", () => {
    // Se o doutor escrever a técnica, o sistema resolve sozinho — é o caminho
    // para destravar os 24 sem palpite nosso.
    expect(matchImportedTreatment("Ana Julia 20 lentes estratificada", VITALLI).treatmentId).toBe("estratificada");
    expect(matchImportedTreatment("Murilo 20 lentes premium", VITALLI).treatmentId).toBe("premium");
  });

  it("devolve os candidatos para quem sabe decidir", () => {
    expect(matchImportedTreatment("HEMRIQUE 20 lentes", VITALLI).ambiguousWith).toHaveLength(3);
  });
});

describe("bordas", () => {
  it("evento sem nenhum tratamento reconhecível fica sem tratamento", () => {
    const match = matchImportedTreatment("Leonardo Paciente R$2.000", VITALLI);
    expect(match.treatmentId).toBeNull();
    expect(match.ambiguousWith).toEqual([]);
  });

  it("texto vazio não quebra", () => {
    expect(matchImportedTreatment("", VITALLI).treatmentId).toBeNull();
    expect(matchImportedTreatment("   ", VITALLI).treatmentId).toBeNull();
  });

  it("tratamento com keywordMatchEnabled=false fica fora", () => {
    const desligado: ImportTreatmentCandidate[] = [
      { id: "off", name: "Manutenção Preventiva de lentes", aliases: ["manutenção"], keywordMatchEnabled: false },
    ];
    expect(matchImportedTreatment("Kevin Manutenção", desligado).treatmentId).toBeNull();
  });

  it("alias curto demais não dispara match acidental", () => {
    // Termos de 3 letras casariam dentro de qualquer palavra.
    const curto: ImportTreatmentCandidate[] = [{ id: "x", name: "Ok", aliases: ["ap"] }];
    expect(matchImportedTreatment("Ana apareceu", curto).treatmentId).toBeNull();
  });
});
