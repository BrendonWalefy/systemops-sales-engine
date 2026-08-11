import { describe, expect, it } from "vitest";
import { dentalResinV1 } from "@/application/templates/dental-resin-v1/manifest";
import { validateManifest } from "@/application/templates/validate-manifest";

/**
 * Estes testes guardam forma e padrão proibido. Eles NÃO julgam se uma resposta
 * vende — ver a seção correspondente do relatório da task. Um manifesto com
 * treze respostas educadas e inúteis passa por aqui inteiro.
 */

const CLINIC_SPECIFIC_VOCABULARY = ["simplificada", "estratificada", "premium", "slim"];

/**
 * Afirmações proibidas.
 *
 * A lista original do plano era de substrings cruas e errava nos dois sentidos:
 * `"garantia de"` deixava passar *"temos garantia para esse trabalho"*, e
 * `"superior"` reprovava *"arcada superior"*, que é o termo clínico correto e
 * aparece na própria auditoria. Cada padrão abaixo registra o que mudou.
 */
const FORBIDDEN_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /não\s+amarela/i, why: "promessa de resultado" },
  { pattern: /nunca\s+mancha/i, why: "promessa de resultado" },
  { pattern: /dura\s+para\s+sempre/i, why: "promessa de durabilidade" },
  {
    pattern: /\bgarant(?:ias|ia|imos|ido|ida|iu|iram|em|e)\b/i,
    why: "qualquer afirmação de cobertura, não só a frase 'garantia de'",
  },
  {
    // O `\b` final que esta regra tinha antes não fechava depois de "à": em
    // JavaScript `\w` é ASCII, então "à" é caractere não-palavra e não há
    // fronteira entre ele e o espaço seguinte. "é superior à outra" passava
    // batido. O lookahead abaixo não depende de fronteira de palavra, e
    // "àquela/aquele" entraram porque "é superior àquela" escapava das duas.
    pattern:
      /\b(?:melhor|superior|pior|inferior)(?:es)?\s+(?:do\s+que|que|àquele|àquela|aquele|aquela|às|aos|à|ao|as|os|a|o)(?=\s|[.,;!?]|$)/i,
    why: "comparativo entre variantes; deixa passar 'arcada superior', que é anatomia",
  },
  {
    // Superlativo, que o comparativo acima não pega: "é a melhor opção" não
    // compara com nada explícito e mesmo assim rankeia as variantes.
    pattern: /\b(?:a|o)\s+(?:melhor|pior)\b/i,
    why: "superlativo; rankeia variante sem citar o termo comparado",
  },
  { pattern: /\bindolor\b/i, why: "afirmação clínica" },
  { pattern: /\bsem\s+(?:risco|riscos|dor|dores)\b/i, why: "afirmação clínica" },
  { pattern: /\bnão\s+dói\b/i, why: "afirmação clínica; a resposta fácil da objeção de dor" },
  { pattern: /\bsem\s+desgaste\b/i, why: "afirmação clínica sobre preparo do dente" },
  { pattern: /\b100\s*%/, why: "absoluto" },
];

/** Fechamentos passivos. O operador humano nunca encerra assim. */
const PASSIVE_CLOSINGS = [
  "é só me chamar",
  "posso ajudar com mais alguma coisa",
  "posso te ajudar com mais alguma coisa",
  "estou à disposição",
  "fico à disposição",
  "estou aqui se precisar",
  "qualquer coisa estou aqui",
];

/**
 * Uma frase "pede informação" se termina em interrogação, traz verbo de pedido,
 * ou COMEÇA com pronome interrogativo. A última condição existe porque contar
 * só "?" deixava passar *"quantos dentes e sua cidade."*; ela é ancorada no
 * início da frase de propósito, senão *"depende de quantos dentes entram"* —
 * declarativa — contaria como pergunta.
 */
const REQUEST_VERB = /\bme\s+(?:diz|conta|fala|informa|manda|envia|passa)\b/i;
const LEADING_INTERROGATIVE =
  /^(?:e\s+|mas\s+|então\s+)?(?:quantos|quantas|quanto|qual|quais|quando|onde|como|quem|por\s+que|o\s+que)\b/i;

function isAsking(sentence: string): boolean {
  const trimmed = sentence.trim();
  return (
    trimmed.includes("?") || REQUEST_VERB.test(trimmed) || LEADING_INTERROGATIVE.test(trimmed)
  );
}

/**
 * Artigo colado num placeholder: a origem de "na check-up inicial".
 *
 * O `\b` inicial que esta regra tinha antes tornava `à|às|ao|aos` alternativas
 * mortas — mesmo mecanismo ASCII documentado acima, agora do lado esquerdo:
 * `/\bà/.test("comparado à outra")` é `false`. E "às {{...}}" é justamente o
 * caso que renderiza pior. `(?:^|[\s(])` não depende de fronteira de palavra.
 */
const ARTICLE_BEFORE_PLACEHOLDER =
  /(?:^|[\s(])(?:a|o|as|os|na|no|nas|nos|da|do|das|dos|à|às|ao|aos|um|uma|uns|umas)\s+\{\{/i;

/**
 * Teto de tamanho da resposta renderizada.
 *
 * A faixa observada no operador humano é 41–120 caracteres. O teto aqui é mais
 * frouxo do que essa faixa de propósito — ele existe para impedir a regressão
 * documentada (respostas passando de 300 caracteres), não para congelar o
 * estilo. Hoje a maior resposta renderiza em 158 caracteres e a mediana em 114.
 */
const RESPONSE_LENGTH_CEILING = 180;

/**
 * Valores representativos para os placeholders bloqueantes.
 *
 * Os nomes de variante são longos e de gêneros diferentes de propósito: são o
 * caso que expõe tanto concordância presa a artigo quanto resposta que estoura
 * o teto só porque a clínica escreve nomes compridos.
 */
const SAMPLE_BLOCKING_VALUES: Record<string, string> = {
  "clinic.displayName": "Clínica Exemplo",
  "price.startingFrom": "R$ 1.500",
  "price.installmentsPolicy": "3x sem juros ou até 21x com taxa",
  "agenda.evaluationLabel": "avaliação",
  "media.priceCard": "arte-de-valores",
  "variant.base.name": "Lentes de Resina Natural",
  "variant.enhanced.name": "Lentes de Resina Artesanal",
  "variant.differenceSummary": "Muda o número de etapas de aplicação e o valor.",
};

function resolvedValues(): Record<string, string> {
  const values: Record<string, string> = { ...SAMPLE_BLOCKING_VALUES };
  for (const placeholder of dentalResinV1.placeholders) {
    if (placeholder.kind === "defaulted") {
      values[placeholder.key] = String(placeholder.defaultValue);
    }
  }
  return values;
}

/** Renderiza o texto; falha alto se algum placeholder não tiver valor. */
function render(text: string): string {
  const values = resolvedValues();
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`placeholder sem valor de amostra: ${key}`);
    }
    return value;
  });
}

/**
 * Todo texto que o template ESCREVE — a fala da assistente e o texto interno.
 *
 * As chaves de objeção ficam de fora de propósito: elas são a fala do LEAD,
 * usada pelo matcher do runtime. O lead pode perfeitamente perguntar "tem
 * garantia?", e proibir a palavra ali tornaria a objeção de garantia
 * incasável. O que a assistente responde continua proibido de afirmar
 * cobertura, e isso é o que estas listas guardam.
 */
function allAuthoredStrings(): string[] {
  return [
    ...dentalResinV1.objections.map((o) => o.response),
    ...dentalResinV1.qualificationQuestions,
    ...dentalResinV1.handoffReasons,
    ...dentalResinV1.placeholders.flatMap((p) => [
      p.label,
      ...(typeof p.defaultValue === "string" ? [p.defaultValue] : []),
    ]),
  ];
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
}

function askingSentences(text: string): string[] {
  return sentences(text).filter(isAsking);
}

describe("dental resin v1 manifest", () => {
  it("passes its own validator", () => {
    expect(validateManifest(dentalResinV1)).toEqual([]);
  });

  it("defines both variants by stable slug", () => {
    expect(dentalResinV1.variants.map((v) => v.slug).sort()).toEqual(["base", "enhanced"]);
  });

  it("never hardcodes a clinic's commercial vocabulary", () => {
    const text = JSON.stringify(dentalResinV1).toLowerCase();
    for (const word of CLINIC_SPECIFIC_VOCABULARY) {
      expect(text).not.toContain(word);
    }
  });

  it("makes no clinical or warranty claim in any authored string", () => {
    for (const authored of allAuthoredStrings()) {
      for (const { pattern, why } of FORBIDDEN_CLAIMS) {
        expect(
          pattern.test(authored),
          `"${authored}" casa com ${pattern} (${why})`,
        ).toBe(false);
      }
    }
  });

  it("asks at most one thing per authorized response", () => {
    for (const { objection, response } of dentalResinV1.objections) {
      expect(
        askingSentences(render(response)).length,
        `objeção "${objection}"`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("does not stack a second request inside the sentence that asks", () => {
    // Heurística, e assumidamente parcial: pega "quantos dentes e sua cidade",
    // não pega dois pedidos costurados sem conectivo. O limite está registrado
    // no relatório.
    for (const { objection, response } of dentalResinV1.objections) {
      for (const sentence of askingSentences(render(response))) {
        expect(
          / e /.test(sentence),
          `objeção "${objection}": a frase que pergunta encadeia um segundo pedido — "${sentence}"`,
        ).toBe(false);
      }
    }
  });

  it("never closes two responses with the same sentence", () => {
    // Mensagem idêntica repetida já é defeito de produção neste projeto, e um
    // lead que pergunta parcelamento, depois durabilidade, depois dor ouviria
    // o mesmo fecho três vezes seguidas.
    const closings = dentalResinV1.objections.map(({ response }) => {
      const parts = sentences(render(response));
      return parts[parts.length - 1]?.trim().toLowerCase();
    });
    expect(new Set(closings).size).toBe(closings.length);
  });

  it("covers the objections the real conversations produced", () => {
    const keys = dentalResinV1.objections.map((o) => o.objection.toLowerCase()).join("|");
    for (const topic of ["preço", "durabilidade", "prazo", "parcel"]) {
      expect(keys).toContain(topic);
    }
  });

  it("covers the two moments most likely to lose the lead", () => {
    const keys = dentalResinV1.objections.map((o) => o.objection.toLowerCase()).join("|");
    // Dor/desgaste é a maior objeção não-financeira da jornada; o "não" macio
    // é o maior vazamento documentado do funil. As chaves são fala do lead,
    // então o teste procura a palavra que o LEAD usa, não o rótulo interno.
    expect(keys).toContain("dor");
    expect(keys).toContain("pensar");
  });

  it("never closes passively", () => {
    for (const { objection, response } of dentalResinV1.objections) {
      const lowered = render(response).toLowerCase();
      for (const closing of PASSIVE_CLOSINGS) {
        expect(lowered, `objeção "${objection}"`).not.toContain(closing);
      }
    }
  });

  it("keeps every rendered response under the length ceiling", () => {
    for (const { objection, response } of dentalResinV1.objections) {
      const rendered = render(response);
      expect(
        rendered.length,
        `objeção "${objection}" renderiza em ${rendered.length} caracteres`,
      ).toBeLessThanOrEqual(RESPONSE_LENGTH_CEILING);
    }
  });

  it("never places an article immediately before a placeholder", () => {
    // Concordância: o valor é texto livre da clínica, então "na {{...}}" vira
    // "na check-up inicial" e "a {{...}}" vira "a Kit Basic".
    for (const authored of allAuthoredStrings()) {
      expect(
        ARTICLE_BEFORE_PLACEHOLDER.test(authored),
        `"${authored}" prende um artigo a um placeholder de texto livre`,
      ).toBe(false);
    }
  });

  it("renders every authored string with no placeholder left behind", () => {
    for (const authored of allAuthoredStrings()) {
      expect(render(authored)).not.toContain("{{");
    }
  });
});
