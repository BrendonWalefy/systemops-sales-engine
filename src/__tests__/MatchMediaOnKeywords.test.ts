import { describe, it, expect } from "vitest";
import { matchMediaOnKeywords } from "@/core/pipeline/ConversationOrchestrator";

const BL = "5d383eb4-7dce-4fe3-a14a-5fad569fe6a7";
const entries = [{ keywords: ["cor", "tom", "tonalidade", "bl1", "bl2", "bl3"], mediaId: BL }];

describe("matchMediaOnKeywords", () => {
  it("retorna o mediaId quando a mensagem casa com uma palavra-chave", () => {
    expect(matchMediaOnKeywords(entries, "qual a cor das lentes")).toBe(BL);
    expect(matchMediaOnKeywords(entries, "que tom fica mais natural")).toBe(BL);
    expect(matchMediaOnKeywords(entries, "consigo a bl2")).toBe(BL);
  });

  it("retorna null quando nenhuma palavra-chave casa", () => {
    expect(matchMediaOnKeywords(entries, "quanto custa o pacote de 10")).toBeNull();
    expect(matchMediaOnKeywords(entries, "posso agendar quinta")).toBeNull();
  });

  it("retorna null quando não há entradas configuradas", () => {
    expect(matchMediaOnKeywords(undefined, "qual a cor")).toBeNull();
    expect(matchMediaOnKeywords([], "qual a cor")).toBeNull();
  });

  it("usa a primeira entrada que casa", () => {
    const multi = [
      { keywords: ["tom"], mediaId: "A" },
      { keywords: ["cor"], mediaId: "B" },
    ];
    expect(matchMediaOnKeywords(multi, "qual o tom e a cor")).toBe("A");
  });
});
