"use client";

import { useEffect } from "react";

export function ConversationReadMarker({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    void fetch(`/api/conversations/${conversationId}/read`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // O destaque da lista se atualiza no proximo refresh se a rede oscilar.
    });
  }, [conversationId]);

  return null;
}
