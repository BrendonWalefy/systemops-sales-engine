"use client";

import { useTransition } from "react";
import { ToggleLeft, ToggleRight } from "lucide-react";
import { toggleAutoReply } from "./actions";

interface Props {
  enabled: boolean;
}

export function ToggleAutoReply({ enabled }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      await toggleAutoReply(enabled);
    });
  }

  return (
    <button
      type="button"
      className="secondary-button"
      style={{ gap: "8px", padding: "0 14px", minHeight: "38px", flexShrink: 0, whiteSpace: "nowrap" }}
      onClick={handleToggle}
      disabled={isPending}
    >
      {enabled ? (
        <ToggleRight size={18} strokeWidth={1.8} style={{ color: "var(--accent-strong)" }} />
      ) : (
        <ToggleLeft size={18} strokeWidth={1.8} />
      )}
      {isPending ? "Salvando..." : enabled ? "Desativar" : "Ativar"}
    </button>
  );
}
