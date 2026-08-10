import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, messages } from "@/infrastructure/db/schema";

// Janela inicial da conversa: a página abre só com as 60 mensagens mais
// recentes — sem isso, abrir um lead antigo (meses de histórico) custa mais
// a cada mensagem nova que ele manda, para sempre. Histórico mais antigo é
// buscado sob demanda pelo botão "Ver mensagens anteriores" do ChatWindow.
export const CONVERSATION_PAGE_SIZE = 60;

export type ConversationMessageCursor = {
  sentAt: Date;
  id: string;
};

export async function listConversationMessages(params: {
  conversationId: string;
  clinicId: string;
  before?: ConversationMessageCursor | null;
}) {
  // Cursor de paginação reversa: só mensagens estritamente mais velhas que o
  // ponto de corte (mesmo desempate sentAt+id do orderBy abaixo).
  const keyset = params.before
    ? or(
        lt(messages.sentAt, params.before.sentAt),
        and(eq(messages.sentAt, params.before.sentAt), lt(messages.id, params.before.id)),
      )
    : undefined;

  // clinicId é obrigatório e só existe em `conversations` — messages não tem
  // coluna própria de clínica. Sem o join+filtro aqui, um conversationId
  // (mesmo que hoje só resolva para uma clínica) deixaria de barrar leitura
  // cross-tenant caso esse invariante mude: buraco de isolamento multi-tenant.
  const conditions = [
    eq(conversations.clinicId, params.clinicId),
    eq(messages.conversationId, params.conversationId),
    keyset,
  ].filter((condition): condition is SQL => condition !== undefined);

  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      mediaUrl: messages.mediaUrl,
      mediaType: messages.mediaType,
      sentAt: messages.sentAt,
      externalId: messages.externalId,
      intent: messages.intent,
      deliveryFormat: messages.deliveryFormat,
      simulated: messages.simulated,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conditions))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(CONVERSATION_PAGE_SIZE + 1);

  // Pede limit+1 pra saber se há mais história sem uma segunda query de
  // count(): se voltou a linha extra (a mais velha do lote), sobra história
  // além da janela. A sentinela é descartada, nunca aparece no resultado.
  const hasMore = rows.length > CONVERSATION_PAGE_SIZE;
  const page = rows.slice(0, CONVERSATION_PAGE_SIZE);

  // `page` veio da mais nova pra mais velha (pra achar o corte); devolvido em
  // ordem cronológica — é assim que o ChatWindow renderiza a conversa.
  return { messages: page.reverse(), hasMore };
}

export type MessageRow = Awaited<ReturnType<typeof listConversationMessages>>["messages"][number];
