import { describe, expect, it } from "vitest";
import {
  computeSilenceStage,
  type StageMessage,
} from "@/core/intelligence/silence-stage";

const lead = (body: string): StageMessage => ({ author: "lead", body });
const clinica = (body: string): StageMessage => ({ author: "agent", body });
const operador = (body: string): StageMessage => ({ author: "clinic_user", body });

describe("Estágio do silêncio — esperando a clínica", () => {
  it("última palavra da pessoa vence tudo, mesmo com valor já cotado", () => {
    // Se a bola está com a gente, o resto é ruído: não é campanha de
    // reativação que essa pessoa precisa, é resposta.
    expect(
      computeSilenceStage([
        lead("quanto custa?"),
        clinica("Fica R$ 1.200."),
        lead("e parcelado?"),
      ]),
    ).toBe("awaiting_clinic");
  });

  it("reconhece operador humano como clínica", () => {
    expect(computeSilenceStage([lead("oi"), operador("Bom dia!")])).toBe("early");
  });
});

describe("Estágio do silêncio — viu o valor e sumiu", () => {
  it("detecta valor cotado pela clínica", () => {
    expect(
      computeSilenceStage([
        lead("quanto custa a lente?"),
        clinica("O investimento é R$ 1.800 por dente."),
      ]),
    ).toBe("after_quote");
  });

  it("aceita R$ colado no número", () => {
    expect(computeSilenceStage([lead("valor?"), clinica("R$1200")])).toBe("after_quote");
  });

  it("valor dito pela PESSOA não conta como cotação da clínica", () => {
    // "meu orçamento é R$ 500" é objeção, não cotação — e a conversa parou
    // sem a clínica ter dado um número.
    expect(
      computeSilenceStage([
        lead("meu orçamento é R$ 500"),
        clinica("Vou verificar com o doutor."),
      ]),
    ).toBe("price_unanswered");
  });
});

describe("Estágio do silêncio — perguntou preço e não foi respondida", () => {
  it("pega a pergunta de preço sem cotação", () => {
    expect(
      computeSilenceStage([
        lead("Qual valor"),
        clinica("Conseguiu ver o vídeo? Temos agenda essa semana."),
      ]),
    ).toBe("price_unanswered");
  });

  it("cobre as formas comuns de perguntar", () => {
    for (const p of [
      "quanto custa",
      "quanto fica",
      "quanto sai",
      "qual o valor",
      "qual preço",
      "valores por favor",
      "tem orçamento?",
      "qual o investimento",
    ]) {
      expect(
        computeSilenceStage([lead(p), clinica("Já te retorno.")]),
        `falhou para: ${p}`,
      ).toBe("price_unanswered");
    }
  });

  it("funciona sem acento", () => {
    expect(computeSilenceStage([lead("qual o preco"), clinica("ok")])).toBe(
      "price_unanswered",
    );
  });
});

describe("Estágio do silêncio — recebeu horários", () => {
  it("detecta lista de horários do menu", () => {
    expect(
      computeSilenceStage([
        lead("quero marcar"),
        clinica("1. Sex 17/07 às 15h\n2. Sáb 18/07 às 8h"),
      ]),
    ).toBe("after_slots");
  });

  it("detecta horário em texto solto", () => {
    expect(
      computeSilenceStage([lead("tem vaga?"), clinica("Tenho quinta às 14h, serve?")]),
    ).toBe("after_slots");
  });

  it("preço cotado tem prioridade sobre horário oferecido", () => {
    // Quem viu o valor E os horários é público de oferta: o valor é o sinal
    // comercial mais forte.
    expect(
      computeSilenceStage([
        lead("quanto e quando?"),
        clinica("R$ 900. Tenho quinta às 14h."),
      ]),
    ).toBe("after_quote");
  });
});

describe("Estágio do silêncio — conversa embrionária", () => {
  it("parou antes de preço ou agenda", () => {
    expect(
      computeSilenceStage([lead("oi"), clinica("Olá! Como posso ajudar?")]),
    ).toBe("early");
  });

  it("conversa vazia não explode", () => {
    expect(computeSilenceStage([])).toBe("early");
    expect(computeSilenceStage([{ author: "lead", body: null }])).toBe("early");
    expect(computeSilenceStage([{ author: "lead", body: "   " }])).toBe("early");
  });

  it("ignora mensagens em branco ao decidir quem falou por último", () => {
    expect(
      computeSilenceStage([
        lead("quanto custa?"),
        clinica("R$ 500."),
        { author: "lead", body: "   " },
      ]),
    ).toBe("after_quote");
  });
});
