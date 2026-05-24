"use client";
import { useTransition } from "react";
import { UserCheck } from "lucide-react";
import { assumeConversation } from "./actions";

export function AssumeButton({ leadId, conversationId }: { leadId: string; conversationId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="secondary-button"
      style={{ width: "100%", justifyContent: "center" }}
      disabled={pending}
      onClick={() =>
        startTransition(() => assumeConversation(leadId, conversationId))
      }
    >
      <UserCheck size={14} />
      {pending ? "Assumindo…" : "Assumir atendimento"}
    </button>
  );
}
