// Consulta importada do Google Calendar precisa gravar o tratamento.
//
// A regra anterior comparava o texto do evento com o NOME COMPLETO do
// tratamento. A agenda real não escreve assim:
//
//   "Kevin Manutenção"          x  "Manutenção Preventiva de lentes"
//   "Ana Julia 20 lentes"       x  "Lentes em Resina Composta"
//   "Keyla remoção 20 lentes"   x  "Remoção de lentes"
//
// Medido em produção (Aurora, 21/07): **0 de 44** eventos importados tinham
// `treatmentId`. Como as regras de pós-atendimento filtram por tratamento, elas
// nunca encontravam ninguém — nenhuma mensagem de cuidados pós-lentes jamais
// saiu. Ver docs/architecture/current.md.
//
// As descrições e os tratamentos abaixo são os reais do banco.

import { describe, expect, it } from "vitest";
import {
  extractEventValueCents,
  matchImportedTreatment,
  resolveImportedEndsAt,
  type ImportTreatmentCandidate,
} from "@/application/calendar/import-calendar-events";

// Catálogo real da Aurora (recorte com os que aparecem na agenda).
const AURORA: ImportTreatmentCandidate[] = [
  {
    id: "composta",
    name: "Lentes em Resina Composta",
    aliases: ["lentes", "lente", "lentes em resina", "facetas", "faceta", "sorriso", "resina"],
    // Guarda-chuva real da família: não é cotável sozinha e carrega o pipeline.
    hasPipeline: true,
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
    // "remoção" solto foi adicionado ao cadastro em 21/07: sem ele, "Keyla
    // remoção 20 lentes" casava só o alias "lentes" e o desempate de família
    // registrava INSTALAÇÃO numa consulta de remoção.
    aliases: ["remoção", "remover lentes", "tirar facetas", "retirar lentes"],
    hasPipeline: true,
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
    ["Vilma avaliação silva", "avaliacao"],
  ])("resolve %s", (summary, expectedId) => {
    expect(matchImportedTreatment(summary, AURORA).treatmentId).toBe(expectedId);
  });

  it("o nome completo continua funcionando quando aparece por extenso", () => {
    expect(matchImportedTreatment("Joana Plástica Gengival", AURORA).treatmentId).toBe("gengival");
  });

  it("pontuação grudada não atrapalha", () => {
    // "Priscila lentes / pagou 100$" — barra e cifrão colados nas palavras.
    expect(matchImportedTreatment("Angelucia 8:30 manutenção 200$", AURORA).treatmentId).toBe("manutencao");
  });
});

describe("família sem técnica cai no guarda-chuva", () => {
  it("'20 lentes' resolve para a entrada genérica da família", () => {
    // 21 dos 44 eventos reais têm essa forma. As três técnicas empatam no alias
    // "lentes"; vence a que carrega o pipeline — a entrada que existe justamente
    // para representar a família quando a técnica não foi dita.
    const match = matchImportedTreatment("Ana Julia 20 lentes", AURORA);
    expect(match.treatmentId).toBe("composta");
    expect(match.ambiguousWith).toEqual([]);
  });

  it("sem guarda-chuva na família, continua sem resolver", () => {
    // Se nenhuma das candidatas empatadas for a genérica, escolher seria chute.
    const semGuardaChuva = AURORA.map((t) =>
      t.id === "composta" ? { ...t, hasPipeline: false } : t,
    );
    const match = matchImportedTreatment("Ana Julia 20 lentes", semGuardaChuva);
    expect(match.treatmentId).toBeNull();
    expect(match.ambiguousWith).toHaveLength(3);
  });

  it("REMOÇÃO não pode virar instalação", () => {
    // O caso perigoso: "remoção 20 lentes" empataria no alias "lentes" e o
    // guarda-chuva registraria instalação — mandando cuidados pós-instalação
    // para quem teve a lente RETIRADA. O alias "remoção" desempata antes, por
    // ser mais específico (7 letras contra 6).
    expect(matchImportedTreatment("Keyla remoção 20 lentes", AURORA).treatmentId).toBe("remocao");
    expect(matchImportedTreatment("Regina Silva 2 mil 200 remoção", AURORA).treatmentId).toBe("remocao");
  });

  it("a técnica escrita no evento desempata", () => {
    // Se o doutor escrever a técnica, o sistema resolve sozinho — é o caminho
    // para destravar os 24 sem palpite nosso.
    expect(matchImportedTreatment("Ana Julia 20 lentes estratificada", AURORA).treatmentId).toBe("estratificada");
    expect(matchImportedTreatment("Murilo 20 lentes premium", AURORA).treatmentId).toBe("premium");
  });

  it("empate entre DUAS genéricas não resolve — devolve os candidatos", () => {
    const duasGenericas: ImportTreatmentCandidate[] = [
      { id: "a", name: "Clareamento caseiro", aliases: ["clareamento"], hasPipeline: true },
      { id: "b", name: "Clareamento consultório", aliases: ["clareamento"], hasPipeline: true },
    ];
    const match = matchImportedTreatment("Joana clareamento", duasGenericas);
    expect(match.treatmentId).toBeNull();
    expect(match.ambiguousWith).toEqual(["Clareamento caseiro", "Clareamento consultório"]);
  });
});

describe("bordas", () => {
  it("evento sem nenhum tratamento reconhecível fica sem tratamento", () => {
    const match = matchImportedTreatment("Leonardo Paciente R$2.000", AURORA);
    expect(match.treatmentId).toBeNull();
    expect(match.ambiguousWith).toEqual([]);
  });

  it("texto vazio não quebra", () => {
    expect(matchImportedTreatment("", AURORA).treatmentId).toBeNull();
    expect(matchImportedTreatment("   ", AURORA).treatmentId).toBeNull();
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

// ── Duração do bloco importado ──
//
// A clínica agenda no Google e, na pressa, erra o bloco: das 23 consultas
// futuras da Aurora, 9 estavam mais curtas que o procedimento exige — duas com
// 60min para uma instalação de lentes de 5h. O motor de horários lê a agenda
// interna, via a tarde livre e podia ofertá-la a outro lead.

const at = (iso: string) => new Date(iso);
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

describe("resolveImportedEndsAt", () => {
  const inicio = at("2026-07-25T11:00:00.000Z");

  it("estende o bloco curto até a duração cadastrada (caso real: 60min para lentes de 5h)", () => {
    const fim = resolveImportedEndsAt({
      startsAt: inicio,
      eventEndsAt: at("2026-07-25T12:00:00.000Z"),
      treatmentDurationMinutes: 300,
    });
    expect(minutesBetween(inicio, fim)).toBe(300);
  });

  it("NUNCA encurta — bloco maior é procedimento combinado, e o doutor sabe", () => {
    // "Amanda 20 lentes + Remoção": 240min de bloco contra 90 de cadastro.
    // Encurtar liberaria tempo reservado e a IA ofertaria em cima.
    const fimReal = at("2026-07-25T15:00:00.000Z"); // 240min
    const fim = resolveImportedEndsAt({
      startsAt: inicio,
      eventEndsAt: fimReal,
      treatmentDurationMinutes: 90,
    });
    expect(fim).toEqual(fimReal);
  });

  it("bloco igual ao cadastro não muda nada", () => {
    const fimReal = at("2026-07-25T11:30:00.000Z");
    expect(
      resolveImportedEndsAt({ startsAt: inicio, eventEndsAt: fimReal, treatmentDurationMinutes: 30 }),
    ).toEqual(fimReal);
  });

  it("sem tratamento identificado, respeita o Google", () => {
    // Sem saber o procedimento não há o que garantir — inventar duração aqui
    // bloquearia agenda por chute.
    const fimReal = at("2026-07-25T11:45:00.000Z");
    for (const dur of [null, 0]) {
      expect(
        resolveImportedEndsAt({ startsAt: inicio, eventEndsAt: fimReal, treatmentDurationMinutes: dur }),
      ).toEqual(fimReal);
    }
  });
});

// ── Valor do atendimento ──
//
// A home soma valueCents para mostrar faturamento potencial e realizado. Medido
// em 21/07: 45 de 46 consultas da Aurora tinham valueCents nulo e os dois
// números apareciam como R$ 0 — com o valor escrito na agenda o tempo todo.

describe("extractEventValueCents", () => {
  it.each([
    ["Laís Manutenção R$400", 40000],
    ["Leonardo Paciente R$2.000", 200000],
    ["Amanda 20 lentes + Remoção R$2200", 220000],
    ["Angelucia 8:30 manutenção 200$", 20000],
    ["Tatiana 20 lentes 2 mil", 200000],
    ["Regina Silva Rodrigues 2 mil 200 remoção", 200000],
  ])("extrai de %s", (summary, esperado) => {
    expect(extractEventValueCents(summary)).toBe(esperado);
  });

  it("soma quando o evento itemiza um atendimento combinado", () => {
    // Os dois procedimentos acontecem na mesma cadeira: o valor da consulta é a soma.
    expect(extractEventValueCents("Mercia 20 lentes R$2.000 e plástica gengival R$1.000")).toBe(300000);
    expect(extractEventValueCents("Denis William R$3.000 com a plástica + R$400 da remoção")).toBe(340000);
  });

  it("NÃO confunde quantidade com dinheiro", () => {
    // "20 lentes" é quantidade. Sem marcador de moeda, não vira R$ 20.
    expect(extractEventValueCents("Ana Julia 20 lentes")).toBeNull();
    expect(extractEventValueCents("André 10 lentes inferiores já paga")).toBeNull();
  });

  it("NÃO confunde horário com dinheiro", () => {
    expect(extractEventValueCents("Vilma avaliação 8:30 silva")).toBeNull();
  });

  it("NÃO soma alternativas de preço", () => {
    // "2500 se fizer raspagem 2650" são dois cenários, não duas parcelas.
    // Sem cifra explícita, nenhum dos dois é lido — melhor nulo que R$ 5.150.
    expect(extractEventValueCents("MURILO 20 lentes + PLÁSTICA SUPERIOR 2500 se fizer raspagem 2650")).toBeNull();
  });

  it("evento sem valor continua sem valor", () => {
    expect(extractEventValueCents("Kevin Manutenção")).toBeNull();
    expect(extractEventValueCents("Vitor manutenção gratuita")).toBeNull();
    expect(extractEventValueCents("")).toBeNull();
  });
});
