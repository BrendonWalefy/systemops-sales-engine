"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import type { Treatment } from "@/domain/entities/treatment";
import { deleteTreatment, updateTreatment } from "./actions";

function SaveButton({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();

  if (pending) {
    return (
      <button
        type="submit"
        className="primary-button"
        disabled
        style={{ padding: "7px 12px", gap: "6px", fontSize: "13px", opacity: 0.7 }}
      >
        <Loader2 size={13} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
        Salvando...
      </button>
    );
  }

  if (saved) {
    return (
      <button
        type="submit"
        className="primary-button"
        style={{ padding: "7px 12px", gap: "6px", fontSize: "13px", background: "var(--accent-muted, #065f46)" }}
      >
        <CheckCircle2 size={13} strokeWidth={2} />
        Salvo
      </button>
    );
  }

  return (
    <button
      type="submit"
      className="primary-button"
      style={{ padding: "7px 12px", gap: "6px", fontSize: "13px" }}
    >
      <Save size={13} strokeWidth={2} />
      Salvar
    </button>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function TreatmentRow({
  treatment,
  isLast,
  canEditPrices,
  serviceNoun,
}: {
  treatment: Treatment;
  isLast: boolean;
  canEditPrices: boolean;
  serviceNoun: string;
}) {
  const [state, formAction] = useActionState(updateTreatment, null);

  const hasRange = treatment.minPriceCents != null || treatment.maxPriceCents != null;

  return (
    <form
      action={formAction}
      className="treatment-form"
      style={{
        display: "grid",
        gridTemplateColumns: canEditPrices ? "1fr 130px 180px auto auto" : "1fr 130px auto auto",
        alignItems: "center",
        gap: "10px",
        padding: "12px 22px",
        borderBottom: !isLast ? "1px solid var(--line)" : undefined,
      }}
    >
      <input type="hidden" name="id" value={treatment.id} />
      <input
        type="text"
        name="name"
        defaultValue={treatment.name}
        required
        style={{ margin: 0, fontSize: "16px" }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
        <input
          type="number"
          name="durationMinutes"
          defaultValue={treatment.durationMinutes}
          min={5}
          max={480}
          step={5}
          required
          style={{ width: "72px", textAlign: "center", margin: 0, fontSize: "16px" }}
        />
        <span style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
          min · {formatDuration(treatment.durationMinutes)}
        </span>
      </label>

      {canEditPrices && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {hasRange ? (
            <>
              <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>R$</span>
              <input
                type="number"
                name="minPriceCents"
                defaultValue={treatment.minPriceCents != null ? treatment.minPriceCents / 100 : ""}
                min={0}
                step={0.01}
                placeholder="mín"
                style={{ width: "64px", textAlign: "center", margin: 0, fontSize: "13px" }}
              />
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>–</span>
              <input
                type="number"
                name="maxPriceCents"
                defaultValue={treatment.maxPriceCents != null ? treatment.maxPriceCents / 100 : ""}
                min={0}
                step={0.01}
                placeholder="máx"
                style={{ width: "64px", textAlign: "center", margin: 0, fontSize: "13px" }}
              />
            </>
          ) : (
            <>
              <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>R$</span>
              <input
                type="number"
                name="priceCents"
                defaultValue={treatment.priceCents != null ? treatment.priceCents / 100 : ""}
                min={0}
                step={0.01}
                placeholder="opcional"
                style={{ width: "90px", textAlign: "center", margin: 0, fontSize: "13px" }}
              />
            </>
          )}
          <button
            type="button"
            title={hasRange ? "Mudar para preço único" : "Mudar para faixa de preço"}
            onClick={(e) => {
              // toggle range — usando hidden inputs para sinalizar ao servidor
              const form = (e.currentTarget as HTMLButtonElement).closest("form") as HTMLFormElement;
              const toggle = form.querySelector<HTMLInputElement>('input[name="useRange"]');
              if (toggle) toggle.value = hasRange ? "0" : "1";
              form.requestSubmit();
            }}
            style={{
              padding: "2px 5px",
              fontSize: "10px",
              border: "1px solid var(--line)",
              borderRadius: "4px",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {hasRange ? "único" : "faixa"}
          </button>
          <input type="hidden" name="useRange" value={hasRange ? "1" : "0"} />
        </div>
      )}

      <div className="treatment-save-btn">
        <SaveButton saved={state?.success === true} />
      </div>

      <button
        type="submit"
        formAction={deleteTreatment}
        title={`Remover ${serviceNoun}`}
        className="treatment-delete-btn"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "7px 10px",
          fontSize: "13px",
          border: "1px solid var(--line)",
          borderRadius: "8px",
          background: "transparent",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        <Trash2 size={13} strokeWidth={2} />
      </button>
    </form>
  );
}
