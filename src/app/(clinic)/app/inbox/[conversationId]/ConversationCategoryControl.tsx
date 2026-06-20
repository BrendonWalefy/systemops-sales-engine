"use client";

import { useTransition } from "react";
import type { ConversationCategory } from "@/domain/value-objects/conversation-category";
import { conversationCategoryLabel } from "../inbox-utils";
import { setConversationCategory } from "./actions";

const CATEGORY_OPTIONS: ConversationCategory[] = [
  "sales",
  "operational",
  "vendor",
  "spam",
  "archived",
];

const CATEGORY_HINT: Record<ConversationCategory, string> = {
  sales: "Conta no funil e mantém automações comerciais ativas.",
  operational: "Fora do funil. Use para entregas, recados e assuntos internos.",
  vendor: "Fora do funil. Use para fornecedores e prospecções recebidas pela clínica.",
  spam: "Fora do funil. Silencia conversas irrelevantes ou indesejadas.",
  archived: "Fora do funil. Mantém histórico sem poluir a operação diária.",
};

export function ConversationCategoryControl({
  conversationId,
  category,
}: {
  conversationId: string;
  category: ConversationCategory;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="eyebrow" style={{ margin: 0 }}>Categoria</p>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
        {CATEGORY_HINT[category]}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATEGORY_OPTIONS.map((option) => {
          const active = option === category;
          return (
            <button
              key={option}
              type="button"
              className="conv-chip"
              disabled={isPending && !active}
              onClick={() => {
                if (active) return;
                startTransition(async () => {
                  await setConversationCategory(conversationId, option);
                });
              }}
              style={active
                ? {
                    borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
                    color: "var(--accent-strong)",
                    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  }
                : undefined}
              title={CATEGORY_HINT[option]}
            >
              {conversationCategoryLabel(option)}
            </button>
          );
        })}
      </div>
      {isPending && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Atualizando categoria…
        </div>
      )}
    </div>
  );
}
