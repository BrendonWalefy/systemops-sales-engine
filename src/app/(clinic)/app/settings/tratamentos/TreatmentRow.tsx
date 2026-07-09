"use client";
import { useState, useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Save, Trash2, Pencil, X } from "lucide-react";
import type { Treatment } from "@/domain/entities/treatment";
import { deleteTreatment, updateTreatment } from "./actions";
import { S, inputStyle, formatPriceBRL } from "../playbook/settings-primitives";
import { DurationHoursInput } from "@/components/DurationHoursInput";
import { formatDurationLabel } from "@/core/scheduling/durationFormat";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        height: "34px", padding: "0 14px", borderRadius: "8px",
        border: "none", background: pending ? S.tealDark : S.teal,
        color: "#071115", fontSize: "12px", fontWeight: 700,
        cursor: pending ? "default" : "pointer", flexShrink: 0,
      }}
    >
      {pending
        ? <Loader2 size={12} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
        : <Save size={12} strokeWidth={2} />}
      {pending ? "Salvando..." : "Salvar"}
    </button>
  );
}

export function TreatmentRow({
  treatment,
  isLast,
  canEditPrices,
  serviceNoun,
  mode = "full",
}: {
  treatment: Treatment;
  isLast: boolean;
  canEditPrices: boolean;
  serviceNoun: string;
  mode?: "full" | "info" | "price";
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateTreatment, null);

  const hasRange = treatment.minPriceCents != null || treatment.maxPriceCents != null;
  const noPriceSet =
    treatment.priceCents == null &&
    treatment.minPriceCents == null &&
    treatment.maxPriceCents == null;

  useEffect(() => {
    if (!state?.success) return;

    const timeoutId = window.setTimeout(() => setEditing(false), 0);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  const rowBorder = isLast ? "none" : `1px solid ${S.border}`;

  const editBtn = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "28px", height: "28px", borderRadius: "7px",
        border: `1px solid ${S.border}`, background: "transparent",
        color: S.textMuted, cursor: "pointer", flexShrink: 0,
      }}
    >
      <Pencil size={12} strokeWidth={1.8} />
    </button>
  );

  const cancelBtn = (
    <button
      type="button"
      onClick={() => setEditing(false)}
      style={{
        display: "flex", alignItems: "center", gap: "5px",
        height: "34px", padding: "0 12px", borderRadius: "8px",
        border: `1px solid ${S.border}`, background: "transparent",
        color: S.textSec, fontSize: "12px", cursor: "pointer", flexShrink: 0,
      }}
    >
      <X size={12} />
      Cancelar
    </button>
  );

  /* ─── Conhecimento mode ─────────────────────────────────────────────────── */
  if (mode === "info") {
    return (
      <div style={{ borderBottom: rowBorder }}>
        {!editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px" }}>
            <span style={{ flex: 1, fontSize: "14px", fontWeight: 500, color: S.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {treatment.name}
            </span>
            <span style={{
              fontSize: "12px", fontWeight: 700, color: S.teal,
              background: "rgba(0,224,178,0.08)", border: "1px solid rgba(0,224,178,0.15)",
              padding: "3px 10px", borderRadius: "8px", flexShrink: 0,
            }}>
              {formatDurationLabel(treatment.durationMinutes)}
            </span>
            {editBtn}
          </div>
        ) : (
          <form action={formAction} style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <input type="hidden" name="id" value={treatment.id} />
            <input type="hidden" name="useRange" value={hasRange ? "1" : "0"} />
            {hasRange ? (
              <>
                <input type="hidden" name="minPriceCents" value={treatment.minPriceCents != null ? treatment.minPriceCents / 100 : ""} />
                <input type="hidden" name="maxPriceCents" value={treatment.maxPriceCents != null ? treatment.maxPriceCents / 100 : ""} />
              </>
            ) : (
              <input type="hidden" name="priceCents" value={treatment.priceCents != null ? treatment.priceCents / 100 : ""} />
            )}

            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                name="name"
                defaultValue={treatment.name}
                required
                style={{ ...inputStyle, flex: 1, minWidth: "160px" }}
              />
              <DurationHoursInput
                name="durationMinutes"
                defaultMinutes={treatment.durationMinutes}
                required
                inputStyle={inputStyle}
                labelStyle={{ color: S.textSec }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <SaveButton />
              {cancelBtn}
              <button
                type="submit"
                formAction={deleteTreatment}
                title={`Remover ${serviceNoun}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  height: "34px", width: "34px", borderRadius: "8px",
                  border: `1px solid ${S.border}`, background: "transparent",
                  color: "#f87171", cursor: "pointer", marginLeft: "auto", flexShrink: 0,
                }}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  /* ─── Financeiro mode ───────────────────────────────────────────────────── */
  if (mode === "price") {
    return (
      <div style={{ borderBottom: rowBorder }}>
        {!editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px" }}>
            <span style={{ flex: 1, fontSize: "14px", fontWeight: 500, color: S.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {treatment.name}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              {noPriceSet ? (
                <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(245,165,36,0.12)", color: "#F5A524", border: "1px solid rgba(245,165,36,0.25)" }}>
                  Pendente
                </span>
              ) : (
                <>
                  <span style={{ fontSize: "12px", color: S.textMuted }}>R$</span>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: S.text }}>
                    {hasRange
                      ? treatment.maxPriceCents != null
                        ? `${formatPriceBRL(treatment.minPriceCents)} – ${formatPriceBRL(treatment.maxPriceCents)}`
                        : formatPriceBRL(treatment.minPriceCents)
                      : formatPriceBRL(treatment.priceCents)}
                  </span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "5px", background: S.card, border: `1px solid ${S.border}`, color: S.textMuted }}>
                    {hasRange ? "faixa" : "único"}
                  </span>
                </>
              )}
            </div>
            {editBtn}
          </div>
        ) : (
          <form action={formAction} style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <input type="hidden" name="id" value={treatment.id} />
            <input type="hidden" name="name" value={treatment.name} />
            <input type="hidden" name="durationMinutes" value={treatment.durationMinutes} />
            <input type="hidden" name="useRange" value={hasRange ? "1" : "0"} />

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: S.textSec, fontWeight: 500 }}>{treatment.name}</span>
              <span style={{ fontSize: "12px", color: S.textMuted }}>·</span>
              <span style={{ fontSize: "12px", color: S.textMuted }}>R$</span>
              {hasRange ? (
                <>
                  <input type="number" name="minPriceCents" defaultValue={treatment.minPriceCents != null ? treatment.minPriceCents / 100 : ""} min={0} step={0.01} placeholder="mín" style={{ ...inputStyle, width: "80px", textAlign: "center" }} />
                  <span style={{ fontSize: "11px", color: S.textMuted }}>–</span>
                  <input type="number" name="maxPriceCents" defaultValue={treatment.maxPriceCents != null ? treatment.maxPriceCents / 100 : ""} min={0} step={0.01} placeholder="máx" style={{ ...inputStyle, width: "80px", textAlign: "center" }} />
                </>
              ) : (
                <input type="number" name="priceCents" defaultValue={treatment.priceCents != null ? treatment.priceCents / 100 : ""} min={0} step={0.01} placeholder="valor" style={{ ...inputStyle, width: "110px", textAlign: "center" }} />
              )}
              <button
                type="button"
                title={hasRange ? "Mudar para preço único" : "Mudar para faixa"}
                onClick={(e) => {
                  const form = (e.currentTarget as HTMLButtonElement).closest("form") as HTMLFormElement;
                  const toggle = form.querySelector<HTMLInputElement>('input[name="useRange"]');
                  if (toggle) toggle.value = hasRange ? "0" : "1";
                  form.requestSubmit();
                }}
                style={{ padding: "0 9px", height: "34px", fontSize: "11px", border: `1px solid ${S.border}`, borderRadius: "7px", background: "transparent", color: S.textSec, cursor: "pointer", flexShrink: 0 }}
              >
                {hasRange ? "→ único" : "→ faixa"}
              </button>
            </div>

            {/* Item 3: como a IA fala este preço (derivado deste cadastro). */}
            <input type="hidden" name="priceFlagsPresent" value="1" />
            <p style={{ fontSize: "11px", color: S.textMuted, margin: 0 }}>
              Se marcado, a IA fala este valor no chat (gerado deste cadastro, sem digitar preço na Política Comercial). Desmarcado = &ldquo;definido na avaliação&rdquo;.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: S.textSec, cursor: "pointer" }}>
                <input type="checkbox" name="priceQuotableInChat" value="1" defaultChecked={treatment.priceQuotableInChat} />
                Cotar no chat
              </label>
              <select name="priceKind" defaultValue={treatment.priceKind} style={{ ...inputStyle, height: "32px", padding: "0 8px", fontSize: "12px", width: "auto" }}>
                <option value="from">a partir de</option>
                <option value="fixed">valor fixo</option>
              </select>
              <input type="text" name="priceUnit" defaultValue={treatment.priceUnit ?? ""} placeholder="unidade (ex: 20 elementos)" style={{ ...inputStyle, height: "32px", fontSize: "12px", width: "180px" }} />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: S.textSec, cursor: "pointer" }}>
                <input type="checkbox" name="priceDeductible" value="1" defaultChecked={treatment.priceDeductible} />
                Abatido do tratamento
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <SaveButton />
              {cancelBtn}
            </div>
          </form>
        )}
      </div>
    );
  }

  /* ─── Full mode (original — unchanged) ─────────────────────────────────── */
  return (
    <form
      action={formAction}
      className="treatment-form"
      style={{
        display: "grid",
        gridTemplateColumns: canEditPrices ? "1fr 170px 180px auto auto" : "1fr 170px auto auto",
        alignItems: "center",
        gap: "10px",
        padding: "12px 22px",
        borderBottom: !isLast ? "1px solid var(--line)" : undefined,
      }}
    >
      <input type="hidden" name="id" value={treatment.id} />
      <input type="text" name="name" defaultValue={treatment.name} required style={{ margin: 0, fontSize: "14px" }} />
      <DurationHoursInput
        name="durationMinutes"
        defaultMinutes={treatment.durationMinutes}
        required
        inputStyle={{ margin: 0, fontSize: "16px" }}
        labelStyle={{ color: "var(--muted)", whiteSpace: "nowrap" }}
      />
      {canEditPrices && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {hasRange ? (
            <>
              <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>R$</span>
              <input type="number" name="minPriceCents" defaultValue={treatment.minPriceCents != null ? treatment.minPriceCents / 100 : ""} min={0} step={0.01} placeholder="mín" style={{ width: "64px", textAlign: "center", margin: 0, fontSize: "13px" }} />
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>–</span>
              <input type="number" name="maxPriceCents" defaultValue={treatment.maxPriceCents != null ? treatment.maxPriceCents / 100 : ""} min={0} step={0.01} placeholder="máx" style={{ width: "64px", textAlign: "center", margin: 0, fontSize: "13px" }} />
            </>
          ) : (
            <>
              <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>R$</span>
              <input type="number" name="priceCents" defaultValue={treatment.priceCents != null ? treatment.priceCents / 100 : ""} min={0} step={0.01} placeholder="opcional" style={{ width: "90px", textAlign: "center", margin: 0, fontSize: "13px" }} />
            </>
          )}
          <button
            type="button"
            title={hasRange ? "Mudar para preço único" : "Mudar para faixa de preço"}
            onClick={(e) => {
              const form = (e.currentTarget as HTMLButtonElement).closest("form") as HTMLFormElement;
              const toggle = form.querySelector<HTMLInputElement>('input[name="useRange"]');
              if (toggle) toggle.value = hasRange ? "0" : "1";
              form.requestSubmit();
            }}
            style={{ padding: "2px 5px", fontSize: "10px", border: "1px solid var(--line)", borderRadius: "4px", background: "transparent", color: "var(--muted)", cursor: "pointer", lineHeight: 1.4 }}
          >
            {hasRange ? "único" : "faixa"}
          </button>
          <input type="hidden" name="useRange" value={hasRange ? "1" : "0"} />
        </div>
      )}
      <div className="treatment-save-btn">
        <button type="submit" className="primary-button" style={{ padding: "7px 12px", gap: "6px", fontSize: "13px" }}>
          <Save size={13} strokeWidth={2} />
          Salvar
        </button>
      </div>
      <button type="submit" formAction={deleteTreatment} title={`Remover ${serviceNoun}`} className="treatment-delete-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "7px 10px", fontSize: "13px", border: "1px solid var(--line)", borderRadius: "8px", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
        <Trash2 size={13} strokeWidth={2} />
      </button>
    </form>
  );
}
