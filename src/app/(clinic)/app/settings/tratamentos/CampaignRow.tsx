"use client";
import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Save, Trash2, Pencil, X, Tag } from "lucide-react";
import type { Treatment } from "@/domain/entities/treatment";
import {
  createPriceCampaign,
  updatePriceCampaign,
  togglePriceCampaign,
  deletePriceCampaign,
} from "./campaign-actions";
import { S, inputStyle, formatPriceBRL } from "../playbook/settings-primitives";

export type PriceCampaign = {
  id: string;
  treatmentId: string;
  name: string;
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  priceKind: "from" | "fixed";
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function isCurrentlyLive(campaign: PriceCampaign, now = new Date()): boolean {
  if (!campaign.isActive) return false;
  if (campaign.startsAt && now < campaign.startsAt) return false;
  if (campaign.endsAt && now > campaign.endsAt) return false;
  return true;
}

function SaveButton({ label = "Salvar" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        height: "32px", padding: "0 12px", borderRadius: "8px",
        border: "none", background: pending ? S.tealDark : S.teal,
        color: "#071115", fontSize: "12px", fontWeight: 700,
        cursor: pending ? "default" : "pointer", flexShrink: 0,
      }}
    >
      {pending ? <Loader2 size={12} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={12} strokeWidth={2} />}
      {pending ? "Salvando..." : label}
    </button>
  );
}

function CampaignForm({
  treatment,
  campaign,
  onDone,
}: {
  treatment: Treatment;
  campaign: PriceCampaign | null;
  onDone: () => void;
}) {
  const action = campaign ? updatePriceCampaign : createPriceCampaign;
  const [state, formAction] = useActionState(action, null);
  const [useRange, setUseRange] = useState(
    campaign ? campaign.minPriceCents != null || campaign.maxPriceCents != null : false,
  );

  if (state?.success) onDone();

  return (
    <form action={formAction} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px", background: "rgba(245,165,36,0.04)", border: "1px solid rgba(245,165,36,0.15)", borderRadius: "10px" }}>
      {campaign && <input type="hidden" name="id" value={campaign.id} />}
      <input type="hidden" name="treatmentId" value={treatment.id} />
      <input type="hidden" name="useRange" value={useRange ? "1" : "0"} />

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          name="name"
          placeholder='Nome da campanha (ex: "Promoção de julho")'
          defaultValue={campaign?.name ?? ""}
          required
          style={{ ...inputStyle, height: "32px", fontSize: "12px", flex: 1 }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", color: S.textMuted }}>R$</span>
        {useRange ? (
          <>
            <input type="number" name="minPriceCents" defaultValue={campaign?.minPriceCents != null ? campaign.minPriceCents / 100 : ""} min={0} step={0.01} placeholder="mín" style={{ ...inputStyle, height: "32px", width: "80px", fontSize: "12px", textAlign: "center" }} />
            <span style={{ fontSize: "11px", color: S.textMuted }}>–</span>
            <input type="number" name="maxPriceCents" defaultValue={campaign?.maxPriceCents != null ? campaign.maxPriceCents / 100 : ""} min={0} step={0.01} placeholder="máx" style={{ ...inputStyle, height: "32px", width: "80px", fontSize: "12px", textAlign: "center" }} />
          </>
        ) : (
          <input type="number" name="priceCents" defaultValue={campaign?.priceCents != null ? campaign.priceCents / 100 : ""} min={0} step={0.01} placeholder="valor promocional" style={{ ...inputStyle, height: "32px", width: "120px", fontSize: "12px", textAlign: "center" }} />
        )}
        <button type="button" onClick={() => setUseRange((v) => !v)} style={{ padding: "0 9px", height: "32px", fontSize: "11px", border: `1px solid ${S.border}`, borderRadius: "7px", background: "transparent", color: S.textSec, cursor: "pointer" }}>
          {useRange ? "→ único" : "→ faixa"}
        </button>
        <select name="priceKind" defaultValue={campaign?.priceKind ?? treatment.priceKind} style={{ ...inputStyle, height: "32px", padding: "0 8px", fontSize: "12px", width: "auto" }}>
          <option value="from">a partir de</option>
          <option value="fixed">valor fixo</option>
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "11px", color: S.textMuted }}>
          Início (opcional)
          <input type="date" name="startsAt" defaultValue={toDateInputValue(campaign?.startsAt ?? null)} style={{ ...inputStyle, height: "30px", fontSize: "12px", width: "140px" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "11px", color: S.textMuted }}>
          Fim (opcional)
          <input type="date" name="endsAt" defaultValue={toDateInputValue(campaign?.endsAt ?? null)} style={{ ...inputStyle, height: "30px", fontSize: "12px", width: "140px" }} />
        </label>
      </div>

      <p style={{ fontSize: "11px", color: S.textMuted, margin: 0 }}>
        Sem data = fica ativa até você desligar. A IA fala &ldquo;de {formatPriceBRL(treatment.priceCents ?? treatment.minPriceCents)} por [valor promocional]&rdquo; enquanto a campanha estiver ativa.
      </p>

      {state?.error && <p style={{ fontSize: "12px", color: "#f87171", margin: 0 }}>{state.error}</p>}

      <div style={{ display: "flex", gap: "8px" }}>
        <SaveButton label={campaign ? "Salvar" : "Criar campanha"} />
        <button type="button" onClick={onDone} style={{ display: "flex", alignItems: "center", gap: "5px", height: "32px", padding: "0 12px", borderRadius: "8px", border: `1px solid ${S.border}`, background: "transparent", color: S.textSec, fontSize: "12px", cursor: "pointer" }}>
          <X size={12} /> Cancelar
        </button>
      </div>
    </form>
  );
}

export function CampaignRow({ treatment, campaign }: { treatment: Treatment; campaign: PriceCampaign | null }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <CampaignForm treatment={treatment} campaign={campaign} onDone={() => setEditing(false)} />;
  }

  if (!campaign) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 10px", borderRadius: "8px",
          border: `1px dashed ${S.border}`, background: "transparent",
          color: S.textMuted, fontSize: "11px", cursor: "pointer", alignSelf: "flex-start",
        }}
      >
        <Tag size={11} /> + Campanha promocional
      </button>
    );
  }

  const live = isCurrentlyLive(campaign);
  const value = campaign.priceKind === "fixed" ? (campaign.priceCents ?? campaign.minPriceCents) : (campaign.minPriceCents ?? campaign.priceCents);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "6px 10px", borderRadius: "8px", background: live ? "rgba(245,165,36,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${live ? "rgba(245,165,36,0.25)" : S.border}` }}>
      <Tag size={11} style={{ color: live ? S.amber : S.textMuted, flexShrink: 0 }} />
      <span style={{ fontSize: "12px", fontWeight: 600, color: live ? S.amber : S.textMuted }}>{campaign.name}</span>
      <span style={{ fontSize: "12px", color: S.textSec }}>R$ {formatPriceBRL(value)}</span>
      {campaign.endsAt && (
        <span style={{ fontSize: "10px", color: S.textMuted }}>
          até {campaign.endsAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
        </span>
      )}
      <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 7px", borderRadius: "5px", background: live ? "rgba(0,224,178,0.1)" : "rgba(255,255,255,0.05)", color: live ? S.teal : S.textMuted }}>
        {live ? "Ativa" : "Inativa"}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "auto" }}>
        <form
          action={async (formData: FormData) => {
            await togglePriceCampaign(formData);
          }}
        >
          <input type="hidden" name="id" value={campaign.id} />
          <input type="hidden" name="isActive" value={campaign.isActive ? "0" : "1"} />
          <button
            type="submit"
            title={campaign.isActive ? "Desativar campanha" : "Ativar campanha"}
            style={{ height: "26px", padding: "0 8px", fontSize: "10px", border: `1px solid ${S.border}`, borderRadius: "6px", background: "transparent", color: S.textSec, cursor: "pointer" }}
          >
            {campaign.isActive ? "Desativar" : "Ativar"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${S.border}`, background: "transparent", color: S.textMuted, cursor: "pointer" }}
        >
          <Pencil size={11} strokeWidth={1.8} />
        </button>
        <form action={deletePriceCampaign}>
          <input type="hidden" name="id" value={campaign.id} />
          <button type="submit" title="Remover campanha" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${S.border}`, background: "transparent", color: "#f87171", cursor: "pointer" }}>
            <Trash2 size={11} strokeWidth={1.8} />
          </button>
        </form>
      </div>
    </div>
  );
}
