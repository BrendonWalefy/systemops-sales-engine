// A aba clicada tem de ser a aba carregada.
//
// `buildInboxHref` monta a URL a partir de `InboxTabKey`, e `page.tsx` lê o
// mesmo parâmetro de volta para decidir o que buscar. Enquanto o leitor foi
// uma segunda lista escrita à mão, ele ficou para trás: "closed" existia na
// interface (InboxClient renderiza "Fechadas" com a contagem do índice) mas
// não no parser, então clicar em "Fechadas (1.024)" na Vitalli devolvia as 2
// linhas de "Todas" — sem erro, sem tela vazia, só a aba errada.

import { describe, expect, it } from "vitest";
import { INBOX_TAB_KEYS, INBOX_SCOPE_KEYS } from "@/application/inbox/inbox-segmentation";
import { buildInboxHref } from "@/app/(clinic)/app/inbox/inbox-navigation";

async function readPageSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile("src/app/(clinic)/app/inbox/page.tsx", "utf8");
}

describe("roteamento de abas do Inbox", () => {
  it("o parser da página valida contra INBOX_TAB_KEYS, não contra uma lista própria", async () => {
    const source = await readPageSource();

    // Dono único do conjunto de abas. Uma lista de igualdades escrita à mão
    // aqui é exatamente o que deixou "closed" para trás.
    expect(source).toMatch(/INBOX_TAB_KEYS as readonly string\[\]\)\.includes\(filterParam\)/);
    for (const tab of INBOX_TAB_KEYS) {
      expect(source).not.toMatch(new RegExp(`filterParam === "${tab}"`));
    }
  });

  it("toda aba produz uma URL que volta a resolver para ela mesma", () => {
    for (const tab of INBOX_TAB_KEYS) {
      const href = buildInboxHref({ scope: "sales", tab, search: "" });
      const filter = new URL(href, "https://app.test").searchParams.get("filter");

      // "all" é o estado padrão e não entra na URL; todas as outras precisam
      // aparecer, senão o clique some no caminho.
      if (tab === "all") expect(filter).toBeNull();
      else expect(filter).toBe(tab);
    }
  });

  it("todo escopo produz uma URL que volta a resolver para ele mesmo", () => {
    for (const scope of INBOX_SCOPE_KEYS) {
      const href = buildInboxHref({ scope, tab: "all", search: "" });
      const parsed = new URL(href, "https://app.test").searchParams.get("scope");

      if (scope === "sales") expect(parsed).toBeNull();
      else expect(parsed).toBe(scope);
    }
  });
});
