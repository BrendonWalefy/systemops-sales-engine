// A Task 4b cortou a lista da aba em INBOX_PAGE_SIZE e a Task 3 tirou o
// nextCursor da página — o cursor era clinic-wide e não sabia retomar a lista
// de UMA aba. O resultado é que a conversa 41 de uma clínica com 137 ficava
// inalcançável: o badge dizia 137, a tela renderizava 40, e não havia "carregar
// mais", scroll infinito nem parâmetro de página.
//
// A continuação não precisa de cursor de banco: loadInboxSegmentIndex já
// devolve a lista COMPLETA e ordenada de ids por aba. A janela é aritmética
// sobre essa lista; só a leitura cara (as 17 colunas + enriquecimento) fica
// limitada a INBOX_PAGE_SIZE por passo.

import { describe, expect, it } from "vitest";
import { INBOX_PAGE_SIZE } from "@/application/inbox/inbox-cursor";
import {
  parseInboxPageParam,
  selectInboxPageWindow,
} from "@/application/inbox/inbox-page-window";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `conv-${index + 1}`);
}

describe("parseInboxPageParam", () => {
  it("ausente ou vazio é a página 1", () => {
    expect(parseInboxPageParam(undefined)).toBe(1);
    expect(parseInboxPageParam("")).toBe(1);
  });

  it("lê um número de página válido", () => {
    expect(parseInboxPageParam("3")).toBe(3);
  });

  it("lixo na URL não derruba a página nem pula linhas — cai na página 1", () => {
    expect(parseInboxPageParam("abc")).toBe(1);
    expect(parseInboxPageParam("0")).toBe(1);
    expect(parseInboxPageParam("-2")).toBe(1);
    expect(parseInboxPageParam("1.5")).toBe(1);
    expect(parseInboxPageParam("1e9999")).toBe(1);
  });
});

describe("selectInboxPageWindow", () => {
  it("a página 1 é a mesma fatia de antes — nada muda para uma clínica pequena", () => {
    const window = selectInboxPageWindow(ids(12), 1);

    expect(window.ids).toHaveLength(12);
    expect(window.hasMore).toBe(false);
    expect(window.hasPrevious).toBe(false);
    expect(window.pageCount).toBe(1);
  });

  it("137 conversas: a página 1 mostra 1-40 e anuncia que há mais", () => {
    const window = selectInboxPageWindow(ids(137), 1);

    expect(window.ids).toHaveLength(INBOX_PAGE_SIZE);
    expect(window.ids[0]).toBe("conv-1");
    expect(window.ids.at(-1)).toBe("conv-40");
    expect(window.firstIndex).toBe(1);
    expect(window.lastIndex).toBe(40);
    expect(window.totalIds).toBe(137);
    expect(window.hasMore).toBe(true);
    expect(window.hasPrevious).toBe(false);
    expect(window.pageCount).toBe(4);
  });

  it("a conversa 41 É alcançável: página 2 começa exatamente onde a 1 parou", () => {
    // O cenário exato da review — antes desta janela, conv-41 a conv-137
    // não tinham NENHUMA rota de acesso pela interface.
    const window = selectInboxPageWindow(ids(137), 2);

    expect(window.ids[0]).toBe("conv-41");
    expect(window.ids).toHaveLength(INBOX_PAGE_SIZE);
    expect(window.firstIndex).toBe(41);
    expect(window.hasPrevious).toBe(true);
  });

  it("a última página cobre até a última conversa, sem sobra nem buraco", () => {
    const window = selectInboxPageWindow(ids(137), 4);

    expect(window.ids[0]).toBe("conv-121");
    expect(window.ids.at(-1)).toBe("conv-137");
    expect(window.ids).toHaveLength(17);
    expect(window.lastIndex).toBe(137);
    expect(window.hasMore).toBe(false);
  });

  it("todas as páginas juntas cobrem a lista inteira, na ordem, sem repetir", () => {
    const all = ids(137);
    const collected: string[] = [];
    for (let page = 1; page <= selectInboxPageWindow(all, 1).pageCount; page++) {
      collected.push(...selectInboxPageWindow(all, page).ids);
    }
    expect(collected).toEqual(all);
  });

  it("uma página além do fim é grampeada na última em vez de renderizar vazio", () => {
    // URL velha (a clínica encolheu, ou o operador editou a mão): mostrar a
    // última página é melhor que uma aba vazia sob um badge que diz 137.
    const window = selectInboxPageWindow(ids(137), 99);

    expect(window.page).toBe(4);
    expect(window.ids.at(-1)).toBe("conv-137");
    expect(window.hasMore).toBe(false);
  });

  it("lista vazia: uma página só, sem continuação e sem índices inventados", () => {
    const window = selectInboxPageWindow([], 1);

    expect(window.ids).toEqual([]);
    expect(window.page).toBe(1);
    expect(window.pageCount).toBe(1);
    expect(window.hasMore).toBe(false);
    expect(window.hasPrevious).toBe(false);
    expect(window.firstIndex).toBe(0);
    expect(window.lastIndex).toBe(0);
  });

  it("exatamente INBOX_PAGE_SIZE conversas não anuncia uma página 2 vazia", () => {
    const window = selectInboxPageWindow(ids(INBOX_PAGE_SIZE), 1);

    expect(window.hasMore).toBe(false);
    expect(window.pageCount).toBe(1);
  });

  it("nunca devolve mais que INBOX_PAGE_SIZE — a leitura cara continua limitada", () => {
    for (const page of [1, 2, 3, 4]) {
      expect(selectInboxPageWindow(ids(500), page).ids.length).toBeLessThanOrEqual(
        INBOX_PAGE_SIZE,
      );
    }
  });
});
