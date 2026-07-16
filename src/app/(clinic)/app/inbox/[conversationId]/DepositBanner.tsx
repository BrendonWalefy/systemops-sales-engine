"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Banner de validação do sinal: aparece quando o lead enviou o comprovante e a equipe
// precisa validar o Pix e confirmar (ou rejeitar) o agendamento. A IA nunca valida
// comprovante — esta é a etapa humana.
export function DepositBanner({
  conversationId,
  slotLabel,
  amountLabel,
}: {
  conversationId: string;
  slotLabel: string;
  amountLabel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "confirm" | "reject">(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "confirm" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/confirm-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Falha ao processar. Tente novamente.");
        return;
      }
      router.refresh();
    } catch {
      setError("Falha de rede. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        margin: "0 28px 4px",
        background: "color-mix(in srgb, #16a34a 8%, var(--surface))",
        border: "1px solid color-mix(in srgb, #16a34a 30%, transparent)",
        borderRadius: 10,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          💸 Comprovante do sinal recebido{amountLabel ? ` (${amountLabel})` : ""}
        </div>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>
          Valide o Pix e confirme o horário de {slotLabel}. A confirmação é enviada automaticamente ao lead.
        </div>
        {error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{error}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => act("confirm")}
          disabled={busy !== null}
          style={{
            background: "#16a34a",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
            opacity: busy && busy !== "confirm" ? 0.5 : 1,
          }}
        >
          {busy === "confirm" ? "Confirmando…" : "Confirmar agendamento"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy !== null}
          style={{
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy === "reject" ? "…" : "Rejeitar"}
        </button>
      </div>
    </div>
  );
}
