"use client";

import { useState, useTransition } from "react";
import { Trash2, X, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

type ResetCounts = {
  leads: number;
  conversations: number;
  messages: number;
  appointments: number;
  calendarBlocks: number;
  followUps: number;
  slotReservations: number;
  agentRecommendations: number;
  conversationStates: number;
  aiUsageCosts: number;
  whatsappMessageCosts: number;
  calendarEventsDeleted: number;
};

export function ResetClinicDialog({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetCounts | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpen() {
    setOpen(true);
    setInput("");
    setDeleteCalendar(false);
    setError(null);
    setResult(null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/clinics/${clinicId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName: input, deleteCalendarEvents: deleteCalendar }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro desconhecido.");
        return;
      }
      setResult(data.counts);
      router.refresh();
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
        <Trash2 size={13} />
        Zerar dados de teste
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
            {/* Header */}
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
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Zerar dados de teste</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    Esta ação é irreversível
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

            {result ? (
              /* Resultado */
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--accent-strong)", fontWeight: 600 }}>
                  Clínica zerada com sucesso.
                </p>
                <div style={{ background: "var(--surface-soft)", borderRadius: 8, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
                  {Object.entries({
                    Leads: result.leads,
                    Conversas: result.conversations,
                    Mensagens: result.messages,
                    Agendamentos: result.appointments,
                    Bloqueios: result.calendarBlocks,
                    "Follow-ups": result.followUps,
                    Reservas: result.slotReservations,
                    Recomendações: result.agentRecommendations,
                    "Custos IA": result.aiUsageCosts,
                    "Custos WA": result.whatsappMessageCosts,
                    "Eventos Google": result.calendarEventsDeleted,
                  }).map(([label, val]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--muted)" }}>{label}</span>
                      <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{val}</span>
                    </div>
                  ))}
                </div>
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
              /* Confirmação */
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 }}>
                  Isso apagará permanentemente todos os <strong>leads, conversas, mensagens,
                  agendamentos, bloqueios e custos</strong> desta clínica. As configurações e tratamentos
                  serão preservados.
                </p>

                {/* Checkbox Google Calendar */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${deleteCalendar ? "var(--danger)" : "var(--line)"}`,
                    background: deleteCalendar ? "rgba(239,68,68,0.05)" : "var(--surface-soft)",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deleteCalendar}
                    onChange={(e) => setDeleteCalendar(e.target.checked)}
                    disabled={isPending}
                    style={{ marginTop: 1, accentColor: "var(--danger)", cursor: "pointer" }}
                  />
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: deleteCalendar ? "var(--danger)" : "var(--text)" }}>
                      Apagar também no Google Calendar
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                      Remove os eventos de teste do calendário da clínica. Eventos sem ID são ignorados.
                    </p>
                  </div>
                </label>

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
                    {isPending ? "Zerando…" : "Confirmar reset"}
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
