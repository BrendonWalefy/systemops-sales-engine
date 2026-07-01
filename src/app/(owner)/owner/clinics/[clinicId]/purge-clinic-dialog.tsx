"use client";

import { useState, useTransition } from "react";
import { Trash2, X, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

const CONFIRM_PHRASE = "EXCLUIR PERMANENTEMENTE";

export function PurgeClinicDialog({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpen() {
    setOpen(true);
    setInput("");
    setError(null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/clinics/${clinicId}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro desconhecido.");
        return;
      }
      setOpen(false);
      router.push("/owner");
      router.refresh();
    });
  }

  const canConfirm = input.trim() === CONFIRM_PHRASE && !isPending;

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
        <Trash2 size={13} />
        Excluir permanentemente
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
              width: 440,
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
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Excluir organização</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    Irreversível — todo o dado é apagado
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

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
                Isso apaga <strong>permanentemente</strong> leads, conversas, mensagens,
                agendamentos, playbooks e todo o histórico de{" "}
                <strong>{clinicName}</strong>. Não pode ser desfeito — não é o mesmo que
                arquivar.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                  Digite <span style={{ color: "var(--text)", fontFamily: "monospace" }}>{CONFIRM_PHRASE}</span> para confirmar
                </label>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
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
                  {isPending ? "Excluindo…" : "Excluir permanentemente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
