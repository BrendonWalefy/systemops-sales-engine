import { describe, expect, it } from "vitest";
import { redactCorpusText } from "@/application/corpus/redact-corpus-text";
import { loadCorpus } from "@/application/corpus/corpus-index";

/**
 * O caso rotulado entra no Git. PII que sobreviver aqui vaza para sempre no
 * histórico do repositório, e não há desfazer barato.
 *
 * Cada forma coberta abaixo apareceu de verdade na primeira extração e passou
 * pelas barreiras existentes. As strings do teste são fabricadas.
 */
describe("barreira de PII do corpus", () => {
  // Anexo de WhatsApp vira "Certidao_Nascimento_Nome_Sobrenome.pdf". Sem espaço
  // e sem título profissional, nenhum detector de nome alcançava.
  it("redige nome de terceiro embutido em nome de arquivo", () => {
    expect(
      redactCorpusText("[documento] Certidao_Nascimento_Joao_Pedro_Silva.pdf"),
    ).toBe("[documento] [ARQUIVO]");
    expect(redactCorpusText("[documento] Boleto_1784667694397.pdf")).toBe(
      "[documento] [ARQUIVO]",
    );
  });

  // Pix copia-e-cola: carrega domínio do banco, UUID e identificador do
  // recebedor num bloco só.
  it("redige payload de pagamento colado pelo lead", () => {
    const pix =
      "00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/9406339b-028d-48c2-bbef-002fc337194f5204000053039865405";
    expect(redactCorpusText(pix)).toBe("[PAGAMENTO]");
  });

  // O rabo do payload EMV continua sendo payload: nome do recebedor, cidade e
  // CRC. Guardar metade de um bloco de pagamento não guarda informação nenhuma
  // e ainda dá a impressão de que aquilo foi revisado.
  it("redige a linha inteira do payload, não só a cabeça", () => {
    expect(
      redactCorpusText(
        "00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/9406339b-028d-48c2-bbef-002fc337194f52040000.435802BR5906SHOPEE6009SAO PAULO62070503***6304CC48",
      ),
    ).toBe("[PAGAMENTO]");
  });

  // O detector antigo exigia `\b` no fim do UUID, e ele falha quando o UUID é
  // seguido de mais dígitos — exatamente o formato do Pix.
  it("redige UUID grudado em outros dígitos", () => {
    expect(
      redactCorpusText("ref 9406339b-028d-48c2-bbef-002fc337194f5204 fim"),
    ).toBe("ref [ID] fim");
  });

  // O detector antigo exigia esquema http(s). Domínio nu passava inteiro.
  it("redige domínio sem esquema", () => {
    expect(redactCorpusText("veja em pix.santander.com.br/qr/v2 ok")).toBe(
      "veja em [URL] ok",
    );
  });

  // O corpus troca o id do tenant por hash justamente para não identificá-lo.
  // O nome comercial da clínica dentro da própria mensagem desfaz isso — e ele
  // nunca foi PII do lead, então nenhum detector de nome olhava para lá.
  it("redige identidade do tenant informada pelo chamador", () => {
    const terms = [
      { term: "Clinica Exemplo", marker: "[NEGOCIO]" },
      { term: "Edifício Aurora", marker: "[LOCAL]" },
      { term: "estação Vila Nova", marker: "[LOCAL]" },
    ];

    expect(
      redactCorpusText(
        "assistente virtual da Clinica Exemplo, no Edifício Aurora, 5 min da estação Vila Nova",
        terms,
      ),
    ).toBe(
      "assistente virtual da [NEGOCIO], no [LOCAL], 5 min da [LOCAL]",
    );
  });

  it("casa a identidade sem acento e em qualquer caixa", () => {
    const terms = [{ term: "Clínica Exemplo", marker: "[NEGOCIO]" }];
    expect(redactCorpusText("da CLINICA EXEMPLO aqui", terms)).toBe(
      "da [NEGOCIO] aqui",
    );
  });

  it("não redige palavra que apenas contém o termo", () => {
    const terms = [{ term: "Vitalli", marker: "[NEGOCIO]" }];
    expect(redactCorpusText("vitallidade e energia", terms)).toBe(
      "vitallidade e energia",
    );
  });

  it("preserva o texto de conversa que interessa avaliar", () => {
    expect(redactCorpusText("quanto custa a lente de resina? fica R$ 2.000")).toBe(
      "quanto custa a lente de resina? fica R$ 2.000",
    );
    expect(redactCorpusText("[MIDIA:IMAGE] [imagem recebida]")).toBe(
      "[MIDIA:IMAGE] [imagem recebida]",
    );
  });
});

describe("corpus commitado", () => {
  const corpus = loadCorpus("evals/corpus");
  const everyText = corpus.cases
    .flatMap((entry) => [
      entry.input.leadMessage,
      ...entry.input.history.map((turn) => turn.body),
      entry.observed.aiResponse ?? "",
      entry.observed.humanResponse ?? "",
    ])
    .join("\n");

  it("não carrega nome de terceiro, arquivo anexado nem payload de pagamento", () => {
    expect(everyText).not.toMatch(/[A-Za-zÀ-ÿ_]+\.(pdf|docx?|xlsx?|jpe?g|png)/i);
    expect(everyText).not.toMatch(/\b\d{20,}/);
    expect(everyText).not.toMatch(/[a-z0-9-]+\.(com|br|net|org)(\.[a-z]{2})?\//i);
  });
});
