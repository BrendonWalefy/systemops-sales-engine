"use client";
import { useState, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { updateClinicOperationalSettings } from "./playbook-version-actions";
import type { Treatment } from "@/domain/entities/treatment";
import { TreatmentRow } from "../tratamentos/TreatmentRow";
import { S, SettingsCard, SettingsSection, SettingsBadge, SaveStatus } from "./settings-primitives";

type InstallmentRow = { n: number; rate: number; active: boolean };

const SAUDE_SERVICE_DEFAULTS: InstallmentRow[] = [
  { n: 1,  rate: 2.99,  active: false },
  { n: 2,  rate: 5.49,  active: false },
  { n: 3,  rate: 5.99,  active: false },
  { n: 4,  rate: 6.99,  active: true  },
  { n: 5,  rate: 7.99,  active: true  },
  { n: 6,  rate: 8.99,  active: false },
  { n: 7,  rate: 9.99,  active: false },
  { n: 8,  rate: 10.99, active: false },
  { n: 9,  rate: 11.99, active: false },
  { n: 10, rate: 12.99, active: true  },
  { n: 11, rate: 13.99, active: false },
  { n: 12, rate: 14.99, active: true  },
  { n: 13, rate: 0, active: false }, { n: 14, rate: 0, active: false }, { n: 15, rate: 0, active: false },
  { n: 16, rate: 0, active: false }, { n: 17, rate: 0, active: false }, { n: 18, rate: 0, active: false },
  { n: 19, rate: 0, active: false }, { n: 20, rate: 0, active: false }, { n: 21, rate: 0, active: false },
  { n: 22, rate: 0, active: false }, { n: 23, rate: 0, active: false }, { n: 24, rate: 0, active: false },
];

function calcPreview(principal: number, rate: number, n: number): string {
  if (rate <= 0 || n <= 0) return "—";
  const val = Math.ceil(principal / (1 - rate / 100) / n);
  return `R$${val.toLocaleString("pt-BR")}`;
}

type ClinicData = {
  installmentRates: { n: number; rate: number; active: boolean }[] | null;
};

export function TabFinanceiro({
  clinic,
  treatments,
  canEditPrices,
  serviceNoun,
}: {
  clinic: ClinicData;
  treatments: Treatment[];
  canEditPrices: boolean;
  serviceNoun: string;
}) {
  const [rows, setRows] = useState<InstallmentRow[]>(() => {
    if (clinic.installmentRates && clinic.installmentRates.length > 0) {
      const saved = new Map(clinic.installmentRates.map((r) => [r.n, r]));
      return SAUDE_SERVICE_DEFAULTS.map((def) => saved.get(def.n) ?? def);
    }
    return SAUDE_SERVICE_DEFAULTS;
  });
  const [previewValue, setPreviewValue] = useState(2500);
  const [previewInput, setPreviewInput] = useState("2.500");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const treatmentsWithoutPrice = treatments.filter(
    (t) => t.priceCents == null && t.minPriceCents == null && t.maxPriceCents == null,
  );

  function triggerSave(next: InstallmentRow[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await updateClinicOperationalSettings({ installmentRates: next });
      setSaving(false);
      setSaved(true);
    }, 800);
  }

  function updateRow(n: number, patch: Partial<InstallmentRow>) {
    const next = rows.map((r) => (r.n === n ? { ...r, ...patch } : r));
    setRows(next);
    triggerSave(next);
  }

  const current12 = rows.slice(0, 12);
  const future = rows.slice(12);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "720px" }}>

      {/* Alerta de preços pendentes */}
      {treatmentsWithoutPrice.length > 0 && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: "10px",
          background: "rgba(245,165,36,0.08)", border: "1px solid rgba(245,165,36,0.2)",
          borderRadius: "10px", padding: "12px 14px",
        }}>
          <AlertTriangle size={15} style={{ color: S.amber, flexShrink: 0, marginTop: "1px" }} />
          <div>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: S.amber }}>
              {treatmentsWithoutPrice.length} procedimento{treatmentsWithoutPrice.length !== 1 ? "s" : ""} sem preço
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: S.textSec }}>
              Agendamentos desses procedimentos não entram no cálculo de receita do dashboard.
              Cadastre os preços na seção abaixo.
            </p>
          </div>
        </div>
      )}

      {/* Valores dos procedimentos */}
      {treatments.length > 0 && (
        <SettingsSection title="Valores dos procedimentos" description="Preços usados para calcular receita prevista no dashboard">
          <SettingsCard style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${S.border}` }}>
              <p style={{ margin: 0, fontSize: S.fs.desc, color: S.textSec }}>
                Altere apenas o preço. Nome e duração são gerenciados em Conhecimento.
              </p>
            </div>
            <div>
              {treatments.map((t, idx) => (
                <TreatmentRow
                  key={t.id}
                  treatment={t}
                  isLast={idx === treatments.length - 1}
                  canEditPrices={canEditPrices}
                  serviceNoun={serviceNoun}
                  mode="price"
                />
              ))}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Parcelamento */}
      <SettingsSection
        title="Parcelamento"
        description="Configure as taxas da sua maquininha. A IA apresenta os valores já com taxa embutida."
        action={
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <span style={{ fontSize: "12px", color: S.textSec }}>Simular para</span>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "12px", color: S.textMuted }}>R$</span>
              <input
                type="text" inputMode="numeric"
                value={previewInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  const num = parseInt(raw) || 0;
                  setPreviewValue(num);
                  setPreviewInput(num.toLocaleString("pt-BR"));
                }}
                style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "8px", color: S.text, fontSize: "13px", width: "110px", padding: "7px 10px 7px 26px", outline: "none" }}
              />
            </div>
          </div>
        }
      >
        {/* 1x–12x */}
        <div>
          <p style={{ margin: "0 0 10px", fontSize: "11px", fontWeight: 700, color: S.textMuted, letterSpacing: "0.07em" }}>ATÉ 12x — OPERADORA ATUAL</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: "6px" }}>
            {current12.map((row) => (
              <div key={row.n} style={{
                background: row.active ? "rgba(0,224,178,0.05)" : S.card,
                border: `1px solid ${row.active ? "rgba(0,224,178,0.2)" : S.border}`,
                borderRadius: "9px", padding: "9px 10px",
                display: "flex", flexDirection: "column", gap: "5px", transition: "all 150ms",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: row.active ? S.text : S.textMuted }}>{row.n}x</span>
                  <button onClick={() => updateRow(row.n, { active: !row.active })} style={{
                    width: "26px", height: "14px", borderRadius: "7px", border: "none",
                    background: row.active ? S.teal : "rgba(255,255,255,0.1)",
                    cursor: "pointer", position: "relative", transition: "background 200ms", flexShrink: 0,
                  }}>
                    <span style={{ position: "absolute", top: "2px", left: row.active ? "14px" : "2px", width: "10px", height: "10px", borderRadius: "50%", background: "#fff", transition: "left 200ms" }} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <input type="text" inputMode="decimal"
                    value={row.rate === 0 ? "" : String(row.rate).replace(".", ",")}
                    onChange={(e) => { const raw = e.target.value.replace(/[^0-9,]/g, ""); const num = parseFloat(raw.replace(",", ".")); updateRow(row.n, { rate: isNaN(num) ? 0 : num }); }}
                    placeholder="0,00"
                    style={{ width: "42px", background: "transparent", border: "none", borderBottom: `1px solid ${row.active ? "rgba(0,224,178,0.3)" : S.border}`, color: row.active ? S.text : S.textSec, fontSize: "12px", outline: "none", padding: "1px 0", textAlign: "right", fontFamily: "inherit" }}
                  />
                  <span style={{ fontSize: "10px", color: S.textSec }}>%</span>
                </div>
                <span style={{ fontSize: "10px", fontWeight: row.active ? 600 : 400, color: row.active ? S.teal : S.textMuted }}>
                  {row.active && row.rate > 0 ? calcPreview(previewValue, row.rate, row.n) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 13x–24x — futuro */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: S.textMuted, letterSpacing: "0.07em" }}>13x – 24x — NOVA OPERADORA</p>
            <SettingsBadge variant="coming">Em breve</SettingsBadge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: "6px" }}>
            {future.map((row) => (
              <div key={row.n} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "9px", padding: "9px 10px", display: "flex", flexDirection: "column", gap: "5px", opacity: 0.4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: S.textMuted }}>{row.n}x</span>
                  <div style={{ width: "26px", height: "14px", borderRadius: "7px", background: "rgba(255,255,255,0.08)" }} />
                </div>
                <span style={{ fontSize: "12px", color: S.textMuted }}>—</span>
                <span style={{ fontSize: "10px", color: S.textMuted }}>—</span>
              </div>
            ))}
          </div>
        </div>

        <SaveStatus saving={saving} saved={saved} />
      </SettingsSection>

    </div>
  );
}
