"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Clock, Loader2, Plus, Stethoscope } from "lucide-react";
import { createTreatment } from "./actions";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary-button"
      disabled={pending}
      style={{ gap: "8px", opacity: pending ? 0.7 : 1 }}
    >
      {pending ? (
        <Loader2 size={14} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
      ) : (
        <Plus size={14} strokeWidth={2} />
      )}
      {pending ? "Adicionando..." : "Adicionar"}
    </button>
  );
}

export function AddTreatmentForm() {
  const [state, formAction] = useActionState(createTreatment, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: "14px",
        background: "var(--surface-soft)",
        padding: "20px 22px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "40px",
            height: "40px",
            flexShrink: 0,
            borderRadius: "10px",
            border: "1px solid var(--line)",
            background: "var(--surface-raised)",
            color: "var(--accent-strong)",
          }}
        >
          <Plus size={18} strokeWidth={1.8} />
        </div>
        <div>
          <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
            Adicionar procedimento
          </strong>
          <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
            A IA reconhece variações de escrita e erros de digitação e bloqueia o tempo exato no calendário.
          </p>
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="treatment-add-form"
        style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: "12px", alignItems: "end" }}
      >
        <label style={{ margin: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <Stethoscope size={12} strokeWidth={2} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>
              Nome do procedimento
            </span>
          </span>
          <input
            type="text"
            name="name"
            placeholder="Ex: 20 Lentes"
            required
            style={{ margin: 0, fontSize: "16px" }}
          />
        </label>

        <label style={{ margin: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <Clock size={12} strokeWidth={2} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 500 }}>
              Duração (min)
            </span>
          </span>
          <input
            type="number"
            name="durationMinutes"
            placeholder="60"
            min={5}
            max={480}
            step={5}
            required
            defaultValue={60}
            style={{ textAlign: "center", margin: 0, fontSize: "16px" }}
          />
        </label>

        <AddButton />
      </form>

      {state?.success && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "12px",
            fontSize: "13px",
            color: "var(--accent-strong)",
          }}
        >
          <CheckCircle2 size={14} strokeWidth={2} />
          Procedimento adicionado com sucesso
        </div>
      )}

      {state?.error && (
        <p style={{ marginTop: "10px", fontSize: "13px", color: "var(--destructive, #ef4444)" }}>
          {state.error}
        </p>
      )}
    </section>
  );
}
