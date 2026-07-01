"use client";
import { useState, useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";
import { createTreatment } from "./actions";
import { S, inputStyle } from "../playbook/settings-primitives";
import { DurationHoursInput } from "@/components/DurationHoursInput";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        height: "36px", padding: "0 16px", borderRadius: "9px",
        border: "none", background: S.teal, color: "#071115",
        fontSize: "13px", fontWeight: 700,
        cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1, flexShrink: 0,
      }}
    >
      {pending
        ? <Loader2 size={13} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
        : <Plus size={13} strokeWidth={2} />}
      {pending ? "Adicionando..." : "Adicionar"}
    </button>
  );
}

export function AddTreatmentForm({
  canEditPrices,
  serviceNoun,
}: {
  canEditPrices: boolean;
  serviceNoun: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createTreatment, null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state?.success) return;

    formRef.current?.reset();
    const timeoutId = window.setTimeout(() => setOpen(false), 0);

    return () => window.clearTimeout(timeoutId);
  }, [state]);

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: "8px",
          width: "100%", padding: "12px 0", background: "transparent",
          border: "none", color: S.teal, fontSize: "14px", fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Plus size={15} strokeWidth={2} />
        Adicionar {serviceNoun}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "4px" }}>
      <form
        ref={formRef}
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "10px" }}
      >
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={nameRef}
            type="text"
            name="name"
            placeholder={`Nome do ${serviceNoun}`}
            required
            style={{ ...inputStyle, flex: 1, minWidth: "160px" }}
          />
          <DurationHoursInput
            name="durationMinutes"
            defaultMinutes={60}
            required
            inputStyle={inputStyle}
            labelStyle={{ color: S.textSec }}
          />
          {canEditPrices && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
              <span style={{ fontSize: "12px", color: S.textMuted }}>R$</span>
              <input
                type="number"
                name="priceCents"
                placeholder="—"
                min={0}
                step={0.01}
                style={{ ...inputStyle, width: "90px", textAlign: "center" }}
              />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <AddButton />
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              height: "36px", padding: "0 12px", borderRadius: "9px",
              border: `1px solid ${S.border}`, background: "transparent",
              color: S.textSec, fontSize: "13px", cursor: "pointer",
            }}
          >
            <X size={12} />
            Cancelar
          </button>
        </div>
      </form>

      {state?.error && (
        <p style={{ margin: 0, fontSize: "12px", color: "#ef4444" }}>{state.error}</p>
      )}
    </div>
  );
}
