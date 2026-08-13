// Vetores de vazamento medidos em 13/08/2026 contra o sanitizador de replay.
// Nove de dez mensagens realistas passaram intactas, inclusive um telefone com
// separador — e o destino desses textos é um dataset de eval em repositório
// PÚBLICO, onde vazamento é irreversível.
//
// A sanitização segue sendo primeira barreira e NÃO aprovação para publicar:
// nome de terceiro sem título, bairro e empregador continuam fora de alcance de
// regex, e por isso a revisão humana permanece obrigatória.
import { describe, expect, it } from "vitest";
import { sanitizeReplayText } from "@/application/replay/sanitize-replay-text";

describe("sanitizeReplayText — telefone", () => {
  it("redige celular com hífen, que hoje escapa por não ser dígito contíguo", () => {
    expect(sanitizeReplayText("meu whats 11 98765-4321", null)).not.toContain("98765");
    expect(sanitizeReplayText("meu whats 11 98765-4321", null)).not.toContain("4321");
  });

  it("redige telefone com espaços entre os blocos", () => {
    const out = sanitizeReplayText("meu telefone é 11 9 8765 4321 pode ligar", null);
    expect(out).not.toContain("8765");
    expect(out).not.toContain("4321");
  });

  it("redige com DDD entre parênteses e com prefixo internacional", () => {
    expect(sanitizeReplayText("liga (11) 98765-4321", null)).not.toContain("98765");
    expect(sanitizeReplayText("+55 11 98765-4321", null)).not.toContain("98765");
  });

  it("redige fixo de oito dígitos", () => {
    expect(sanitizeReplayText("o fixo é 3456-7890", null)).not.toContain("3456");
  });

  it("não confunde preço com telefone", () => {
    expect(sanitizeReplayText("custa 4.000 reais?", null)).toContain("4.000");
    expect(sanitizeReplayText("são 2500 no total", null)).toContain("2500");
  });

  it("não redige horário nem data curta — o eval de agendamento depende deles", () => {
    expect(sanitizeReplayText("pode ser dia 15/06 às 14:30?", null)).toContain("15/06");
    expect(sanitizeReplayText("pode ser dia 15/06 às 14:30?", null)).toContain("14:30");
  });
});

describe("sanitizeReplayText — pessoas além do lead", () => {
  it("redige nome de profissional precedido de título", () => {
    expect(sanitizeReplayText("sou paciente do Dr. Ricardo Mendes há 5 anos", null))
      .not.toContain("Ricardo");
    expect(sanitizeReplayText("falei com a Dra. Ana ontem", null)).not.toContain("Ana");
    expect(sanitizeReplayText("a doutora Fernanda me atendeu", null)).not.toContain("Fernanda");
  });

  it("redige nome depois de vínculo familiar, preservando o vínculo", () => {
    const out = sanitizeReplayText("pode falar com meu marido João, ele resolve", null);
    expect(out).not.toContain("João");
    expect(out).toContain("marido");
  });

  it("preserva o resto da frase para o fenômeno linguístico sobreviver", () => {
    const out = sanitizeReplayText("sou paciente do Dr. Ricardo há 5 anos", null);
    expect(out).toContain("paciente");
    expect(out).toContain("5 anos");
  });
});

describe("sanitizeReplayText — data de nascimento", () => {
  it("redige data com ano de quatro dígitos", () => {
    expect(sanitizeReplayText("nasci em 15/03/1985", null)).not.toContain("1985");
  });

  it("mantém data curta de agendamento", () => {
    expect(sanitizeReplayText("marca dia 20/08", null)).toContain("20/08");
  });
});

describe("sanitizeReplayText — o que já funcionava continua funcionando", () => {
  it("redige o nome do lead quando conhecido", () => {
    expect(sanitizeReplayText("Oi, aqui é a Maria", "Maria Silva")).toContain("[PACIENTE]");
  });

  it("redige email, CPF e URL", () => {
    expect(sanitizeReplayText("meu email é joao@teste.com", null)).toContain("[EMAIL]");
    expect(sanitizeReplayText("cpf 123.456.789-01", null)).toContain("[CPF]");
    expect(sanitizeReplayText("veja https://x.com/y", null)).toContain("[URL]");
  });

  it("mensagem sem PII atravessa sem alteração", () => {
    expect(sanitizeReplayText("quanto custa a lente?", null)).toBe("quanto custa a lente?");
  });
});
