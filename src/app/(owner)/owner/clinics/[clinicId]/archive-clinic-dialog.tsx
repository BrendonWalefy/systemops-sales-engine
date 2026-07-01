"use client";

import { useState, useTransition } from "react";
import { Archive, X, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export function ArchiveClinicDialog({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpen() {
    setOpen(true);
    setInput("");
    setError(null);
    setDone(false);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    if (done) router.refresh();
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/clinics/${clinicId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName: input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro desconhecido.");
        return;
      }
      setDone(true);
    });
  }

  const canConfirm = input.trim() === clinicName.trim() && !isPending;

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--danger)",
          background: "transparent",
          border: "1px solid var(--danger)",
          borderRadius: 8,
          padding: "6px 14px",
          cursor: "pointer",
          opacity: 0.85,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <Archive size={13} />
        Arquivar organização
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: 14,
              padding: 28,
              width: 420,
              maxWidth: "90vw",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <AlertTriangle size={18} color="var(--danger)" />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Arquivar organização</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    Reversível — nenhum dado é apagado
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                disabled={isPending}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            {done ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--accent-strong)", fontWeight: 600 }}>
                  Organização arquivada. A IA foi desligada e ela saiu dos KPIs de faturamento.
                </p>
                <button
                  onClick={handleClose}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--surface-soft)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  Fechar
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
                  Isso desliga a IA, encerra o shadow mode e move a organização para
                  &quot;Cancelada&quot; — ela some da visão ativa e do faturamento, mas
                  <strong> nenhum lead, conversa ou agendamento é apagado</strong>. Pode ser
                  revertido a qualquer momento pelo botão &quot;Reativar organização&quot;.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                    Digite <span style={{ color: "var(--text)", fontFamily: "monospace" }}>{clinicName}</span> para confirmar
                  </label>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={clinicName}
                    disabled={isPending}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: `1px solid ${error ? "var(--danger)" : "var(--line)"}`,
                      background: "var(--surface-soft)",
                      fontSize: 13,
                      color: "var(--text)",
                      outline: "none",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                    onKeyDown={(e) => e.key === "Enter" && canConfirm && handleConfirm()}
                  />
                  {error && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{error}</p>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={handleClose}
                    disabled={isPending}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--surface-soft)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "var(--text)",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={!canConfirm}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: canConfirm ? "var(--danger)" : "var(--surface-soft)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: canConfirm ? "pointer" : "not-allowed",
                      color: canConfirm ? "#fff" : "var(--muted)",
                      transition: "background 0.15s",
                    }}
                  >
                    {isPending ? "Arquivando…" : "Confirmar arquivamento"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
