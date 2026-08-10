import { INBOX_PAGE_SIZE } from "./inbox-cursor";

// Continuação da lista do Inbox.
//
// `loadInboxSegmentIndex` já devolve a lista COMPLETA e ordenada de ids de
// cada aba/escopo (idsByTab/idsByScope), então a continuação não precisa de
// cursor de banco nenhum: é aritmética sobre essa lista. O que continua
// limitado a INBOX_PAGE_SIZE por passo é a leitura CARA — as 17 colunas de
// `listClinicConversations` mais as cinco consultas de enriquecimento —, que
// é o custo que esta fase existe para limitar.
//
// Dono único desta aritmética: page.tsx fatia por aqui e InboxClient renderiza
// o rodapé a partir do mesmo objeto. Se a fatia e o "há mais" fossem
// calculados em lugares diferentes, o botão de continuar apareceria (ou
// sumiria) sem relação com o que foi realmente buscado.

export type InboxPageWindow = {
  // Página efetivamente renderizada, já grampeada ao intervalo válido.
  page: number;
  pageCount: number;
  ids: string[];
  // Posições 1-based da primeira e da última linha desta página dentro da
  // lista da aba ("mostrando 41-80 de 137"). Zero quando não há linha alguma.
  firstIndex: number;
  lastIndex: number;
  totalIds: number;
  hasMore: boolean;
  hasPrevious: boolean;
};

/**
 * Lê o parâmetro `page` da URL. Qualquer coisa que não seja um inteiro >= 1
 * volta para a página 1: uma URL corrompida tem que reiniciar a lista, nunca
 * derrubar a página nem pular linhas em silêncio.
 */
export function parseInboxPageParam(raw: string | undefined): number {
  if (!raw) return 1;
  if (!/^\d+$/.test(raw.trim())) return 1;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export function selectInboxPageWindow(
  ids: string[],
  page: number,
  pageSize: number = INBOX_PAGE_SIZE,
): InboxPageWindow {
  const totalIds = ids.length;
  const pageCount = Math.max(1, Math.ceil(totalIds / pageSize));
  // Grampeia em vez de renderizar vazio: uma URL de página antiga (a clínica
  // encolheu, o operador editou a mão) tem que cair na última página real, não
  // numa aba vazia embaixo de um badge que anuncia dezenas de conversas.
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);

  const offset = (safePage - 1) * pageSize;
  const slice = ids.slice(offset, offset + pageSize);

  return {
    page: safePage,
    pageCount,
    ids: slice,
    firstIndex: slice.length === 0 ? 0 : offset + 1,
    lastIndex: slice.length === 0 ? 0 : offset + slice.length,
    totalIds,
    hasMore: offset + slice.length < totalIds,
    hasPrevious: safePage > 1,
  };
}
