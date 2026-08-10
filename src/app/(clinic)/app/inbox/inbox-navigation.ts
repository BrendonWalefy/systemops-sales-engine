import type { ConversationCategory } from "@/domain/value-objects/conversation-category";
import type { LiveInboxTabFilter } from "./inbox-filter";

// Único lugar que sabe montar a URL do Inbox a partir de escopo/aba/busca.
// page.tsx lê os mesmos três parâmetros de volta (filter/scope/q) pra
// decidir o que buscar no servidor — se este construtor e aquela leitura
// divergirem, um clique de aba navega pra uma página que não é a aba que
// foi clicada (Fix round 1 — Important #4: este seletor precisava de teste
// próprio, sem passar pelo componente React).
export type InboxNavigationTarget = {
  scope: ConversationCategory;
  tab: LiveInboxTabFilter | "recovery";
  search: string;
  // Continuação da lista. Ausente ou 1 = primeira página, e nesse caso o
  // parâmetro nem entra na URL: o estado padrão continua sendo `/app/inbox`.
  page?: number;
};

export function buildInboxHref(target: InboxNavigationTarget): string {
  const query = new URLSearchParams();

  if (target.scope !== "sales") {
    query.set("scope", target.scope);
  } else if (target.tab !== "all") {
    query.set("filter", target.tab);
  }

  const trimmedSearch = target.search.trim();
  if (trimmedSearch) {
    query.set("q", trimmedSearch);
  }

  const page = target.page ?? 1;
  if (Number.isSafeInteger(page) && page > 1) {
    query.set("page", String(page));
  }

  const queryString = query.toString();
  return queryString ? `/app/inbox?${queryString}` : "/app/inbox";
}
