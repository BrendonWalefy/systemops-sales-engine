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
  resolveImportedEndsAt,
  type ImportTreatmentCandidate,
} from "@/application/calendar/import-calendar-events";

// Catálogo real da Vitalli (recorte com os que aparecem na agenda).
const VITALLI: ImportTreatmentCandidate[] = [
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

describe("família sem técnica cai no guarda-chuva", () => {
  it("'20 lentes' resolve para a entrada genérica da família", () => {
    // 21 dos 44 eventos reais têm essa forma. As três técnicas empatam no alias
    // "lentes"; vence a que carrega o pipeline — a entrada que existe justamente
    // para representar a família quando a técnica não foi dita.
    const match = matchImportedTreatment("Ana Julia 20 lentes", VITALLI);
    expect(match.treatmentId).toBe("composta");
    expect(match.ambiguousWith).toEqual([]);
  });

  it("sem guarda-chuva na família, continua sem resolver", () => {
    // Se nenhuma das candidatas empatadas for a genérica, escolher seria chute.
    const semGuardaChuva = VITALLI.map((t) =>
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
    expect(matchImportedTreatment("Keyla remoção 20 lentes", VITALLI).treatmentId).toBe("remocao");
    expect(matchImportedTreatment("Regina Silva 2 mil 200 remoção", VITALLI).treatmentId).toBe("remocao");
  });

  it("a técnica escrita no evento desempata", () => {
    // Se o doutor escrever a técnica, o sistema resolve sozinho — é o caminho
    // para destravar os 24 sem palpite nosso.
    expect(matchImportedTreatment("Ana Julia 20 lentes estratificada", VITALLI).treatmentId).toBe("estratificada");
    expect(matchImportedTreatment("Murilo 20 lentes premium", VITALLI).treatmentId).toBe("premium");
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

// ── Duração do bloco importado ──
//
// A clínica agenda no Google e, na pressa, erra o bloco: das 23 consultas
// futuras da Vitalli, 9 estavam mais curtas que o procedimento exige — duas com
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
