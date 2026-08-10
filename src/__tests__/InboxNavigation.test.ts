// Testa a construção pura da URL do Inbox — sem React, sem router. Fix round
// 1 (Important #4): antes desta task, nada garantia que um clique de aba
// produzisse a URL certa; o único jeito de descobrir era clicar no app.

import { describe, expect, it } from "vitest";
import { buildInboxHref } from "@/app/(clinic)/app/inbox/inbox-navigation";

describe("buildInboxHref", () => {
  it("escopo sales + aba 'all' + sem busca → caminho puro, sem query string", () => {
    expect(buildInboxHref({ scope: "sales", tab: "all", search: "" })).toBe("/app/inbox");
  });

  it("escopo sales + aba diferente de 'all' → filter, sem scope", () => {
    expect(buildInboxHref({ scope: "sales", tab: "hot", search: "" })).toBe("/app/inbox?filter=hot");
  });

  it("escopo diferente de sales → scope na query, filter é descartado mesmo com aba não-'all'", () => {
    expect(buildInboxHref({ scope: "archived", tab: "hot", search: "" })).toBe("/app/inbox?scope=archived");
  });

  it("busca não-vazia entra como q, já sem os espaços nas pontas", () => {
    expect(buildInboxHref({ scope: "sales", tab: "all", search: "  Ana  " })).toBe("/app/inbox?q=Ana");
  });

  it("combina filter e q quando aba e busca estão ativas ao mesmo tempo", () => {
    expect(buildInboxHref({ scope: "sales", tab: "attention", search: "551199" })).toBe(
      "/app/inbox?filter=attention&q=551199",
    );
  });

  it("escapa caracteres especiais da busca (application/x-www-form-urlencoded)", () => {
    expect(buildInboxHref({ scope: "sales", tab: "all", search: "a&b c" })).toBe("/app/inbox?q=a%26b+c");
  });

  it("busca só com espaços é tratada como ausência de busca", () => {
    expect(buildInboxHref({ scope: "sales", tab: "all", search: "   " })).toBe("/app/inbox");
  });

  it("escopo arquivado + busca: scope e q juntos, sem filter", () => {
    expect(buildInboxHref({ scope: "archived", tab: "all", search: "joao" })).toBe(
      "/app/inbox?scope=archived&q=joao",
    );
  });

  // Continuação da lista (a conversa 41 em diante). A página vive na URL junto
  // com scope/tab/q porque a troca de página é uma navegação de servidor — é
  // page.tsx que decide quais ids valem a leitura cara.
  it("página 1 não aparece na URL — é o estado padrão", () => {
    expect(buildInboxHref({ scope: "sales", tab: "all", search: "", page: 1 })).toBe("/app/inbox");
  });

  it("página > 1 entra como page, junto com filter e q", () => {
    expect(buildInboxHref({ scope: "sales", tab: "hot", search: "ana", page: 3 })).toBe(
      "/app/inbox?filter=hot&q=ana&page=3",
    );
  });

  it("página fora de escopo sales acompanha o scope", () => {
    expect(buildInboxHref({ scope: "archived", tab: "all", search: "", page: 2 })).toBe(
      "/app/inbox?scope=archived&page=2",
    );
  });

  it("página ausente é tratada como 1 — chamadas antigas continuam válidas", () => {
    expect(buildInboxHref({ scope: "sales", tab: "cold", search: "" })).toBe("/app/inbox?filter=cold");
  });
});
