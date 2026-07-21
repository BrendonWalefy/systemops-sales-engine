"use client";
import { useState, useCallback } from "react";
import { Zap, Mic, CalendarDays, BookOpen, Workflow, CreditCard, Timer, CalendarClock, Clock } from "lucide-react";
import type { MenuItem } from "@/domain/entities/clinic";
import type { Treatment } from "@/domain/entities/treatment";
import type { ActiveModule } from "@/application/modules/module-gate";
import type { PriceCampaign } from "../tratamentos/CampaignRow";
import { TabGeral } from "./tab-geral";
import { TabVoz } from "./tab-voz";
import { TabAgenda, type SettingsFocusTarget } from "./tab-agenda";
import { TabConhecimento } from "./tab-conhecimento";
import { TabPlaybooks } from "./tab-playbooks";
import { TabFinanceiro } from "./tab-financeiro";
import { S } from "./settings-primitives";

type Version = {
  id: string;
  name: string;
  status: "active" | "draft" | "historical";
  updatedAt: Date;
};

type ClinicData = {
  name: string | null;
  autoReplyEnabled: boolean | null;
  takeoverTtlHours: number | null;
  postAppointmentBufferMinutes: number | null;
  businessHours: string | null;
  greetingMessage: string | null;
  menuItems: MenuItem[] | null;
  receptionistPhone: string | null;
  staleConversationHours: number | null;
  conversationRestartHours: number | null;
  slotLookaheadDays: number | null;
  mediaTakeoverTtlHours: number | null;
  installmentRates: { n: number; rate: number; active: boolean }[] | null;
  activeModules: ActiveModule[];
};

type Tab = "geral" | "voz" | "agenda" | "conhecimento" | "playbooks" | "financeiro";

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "geral",        label: "Geral",        Icon: Zap },
  { id: "voz",         label: "Voz",          Icon: Mic },
  { id: "agenda",      label: "Agenda",       Icon: CalendarDays },
  { id: "conhecimento",label: "Conhecimento", Icon: BookOpen },
  { id: "playbooks",   label: "Playbooks",    Icon: Workflow },
  { id: "financeiro",  label: "Financeiro",   Icon: CreditCard },
];

export function IASettingsClient({
  clinic,
  versions,
  treatments,
  canEditPrices,
  serviceNoun,
  campaigns = [],
}: {
  clinic: ClinicData;
  versions: Version[];
  treatments: Treatment[];
  canEditPrices: boolean;
  serviceNoun: string;
  campaigns?: PriceCampaign[];
}) {
  const [tab, setTab] = useState<Tab>("geral");
  const hasPriceCampaigns = clinic.activeModules.some((m) => m.key === "price_campaigns");
  const [focusTarget, setFocusTarget] = useState<SettingsFocusTarget | null>(null);
  const handleFocusHandled = useCallback(() => setFocusTarget(null), []);

  const pills = [
    { icon: <Timer size={12} strokeWidth={1.8} />, label: `Pausa Automática (${clinic.takeoverTtlHours ?? 4}h)`, target: "takeover" as const },
    { icon: <CalendarClock size={12} strokeWidth={1.8} />, label: `Intervalo (${clinic.postAppointmentBufferMinutes ?? 60}min)`, target: "buffer" as const },
    { icon: <Clock size={12} strokeWidth={1.8} />, label: `Horário (${clinic.businessHours?.slice(0, 14) ?? "—"})`, target: "hours" as const },
  ];

  return (
    <div className="ia-settings-shell">
      <style>{`
        .ia-settings-shell {
          width: 100%;
          max-width: 100vw;
          overflow-x: hidden;
          -webkit-text-size-adjust: 100%;
          background: ${S.bg};
          min-height: 100%;
        }
        .ia-settings-shell *, .ia-settings-shell *::before, .ia-settings-shell *::after { box-sizing: border-box; }
        .ia-header { padding: 24px 32px 0; border-bottom: 1px solid ${S.border}; }
        .ia-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
        .ia-pills { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .ia-content { padding: 24px 32px; overflow-x: hidden; }
        .ia-versions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
        .ia-settings-shell input,
        .ia-settings-shell textarea,
        .ia-settings-shell select {
          caret-color: ${S.teal};
          min-width: 0;
        }
        .ia-settings-shell input,
        .ia-settings-shell textarea,
        .ia-settings-shell select,
        .ia-settings-shell button,
        .ia-settings-shell a {
          scroll-margin-bottom: calc(112px + env(safe-area-inset-bottom, 0px));
        }
        .ia-settings-shell input:focus,
        .ia-settings-shell textarea:focus,
        .ia-settings-shell select:focus {
          border-color: ${S.borderActive} !important;
          box-shadow: 0 0 0 3px rgba(0,224,178,0.1) !important;
          outline: none !important;
        }
        .ia-tabs { display: flex; gap: 0; }
        .ia-tab-btn {
          display: flex; align-items: center; gap: 6px;
          background: transparent; border: none;
          border-bottom: 2px solid transparent;
          color: ${S.textMuted};
          cursor: pointer; font-size: 13px; font-weight: 500;
          padding: 10px 16px; transition: all 150ms;
          margin-bottom: -1px; white-space: nowrap; flex-shrink: 0;
        }
        .ia-tab-btn.active {
          border-bottom-color: ${S.teal};
          color: ${S.text};
          font-weight: 600;
        }
        .ia-tab-btn:hover:not(.active) { color: ${S.textSec}; }
        @media (max-width: 820px) {
          .ia-settings-shell { padding: 0 !important; }
          .ia-header {
            padding:
              calc(env(safe-area-inset-top, 0px) + 16px)
              calc(env(safe-area-inset-right, 0px) + 16px)
              0
              calc(env(safe-area-inset-left, 0px) + 16px);
          }
          .ia-header-top { flex-direction: column; gap: 12px; margin-bottom: 14px; }
          .ia-pills { display: none; }
          .ia-content {
            padding:
              20px
              calc(env(safe-area-inset-right, 0px) + 16px)
              calc(env(safe-area-inset-bottom, 0px) + 132px)
              calc(env(safe-area-inset-left, 0px) + 16px);
          }
          .ia-tabs { width: 100%; overflow-x: auto; scrollbar-width: none; }
          .ia-tabs::-webkit-scrollbar { display: none; }
          .ia-tab-btn { flex: 1 0 auto; text-align: center; justify-content: center; padding: 10px 10px !important; font-size: 12px !important; min-width: max-content; gap: 4px !important; }
          .ia-versions-grid { grid-template-columns: 1fr; }
          .menu-intent-label { display: none; }
          .treatment-form { grid-template-columns: minmax(0, 1fr) auto !important; grid-template-rows: auto auto auto; padding: 12px !important; gap: 8px !important; align-items: center !important; }
          .treatment-form > input[type="text"] { grid-column: 1 / -1; grid-row: 1; }
          .treatment-form > label { grid-column: 1 / -1; grid-row: 2; align-items: center; min-width: 0; }
          .treatment-form > label input { width: 84px !important; }
          .treatment-form > .treatment-save-btn { grid-column: 1; grid-row: 3; align-self: stretch; }
          .treatment-form > .treatment-save-btn button { width: 100%; justify-content: center; }
          .treatment-form > .treatment-delete-btn { grid-column: 2; grid-row: 3; align-self: stretch; min-width: 42px; }
          .treatment-add-form { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: auto auto auto; }
          .treatment-add-form > label:first-of-type { grid-column: 1 / -1; }
          .treatment-add-form > label:last-of-type { grid-column: 1 / -1; }
          .treatment-add-form > button { grid-column: 1 / -1; align-self: stretch; justify-content: center; }
        }
      `}</style>

      {/* Header */}
      <div className="ia-header">
        <div className="ia-header-top">
          <div>
            <h1 style={{ margin: "0 0 3px", fontSize: "22px", fontWeight: 700, color: S.text }}>Configurações da IA</h1>
            <p style={{ margin: 0, fontSize: "13px", color: S.textSec }}>
              Gerencie o comportamento e o conhecimento da sua inteligência artificial.
            </p>
          </div>
          <div className="ia-pills">
            {pills.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setTab("agenda"); setFocusTarget(p.target); }}
                title="Editar em Agenda"
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 12px",
                  background: S.card, border: `1px solid ${S.border}`,
                  borderRadius: "8px", color: S.textMuted,
                  fontSize: "12px", fontWeight: 500, cursor: "pointer",
                  transition: "border-color 120ms, color 120ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = S.borderActive; (e.currentTarget as HTMLButtonElement).style.color = S.textSec; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = S.border; (e.currentTarget as HTMLButtonElement).style.color = S.textMuted; }}
              >
                <span style={{ color: S.teal }}>{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="ia-tabs">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`ia-tab-btn${tab === id ? " active" : ""}`}
              onClick={() => setTab(id)}
            >
              <Icon size={13} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="ia-content">
        {tab === "geral" && <TabGeral clinic={clinic} />}
        {tab === "voz" && <TabVoz clinic={clinic} />}
        {tab === "agenda" && (
          <TabAgenda
            clinic={clinic}
            focusTarget={focusTarget}
            onFocusHandled={handleFocusHandled}
          />
        )}
        {tab === "conhecimento" && (
          <TabConhecimento
            treatments={treatments}
            canEditPrices={canEditPrices}
            serviceNoun={serviceNoun}
          />
        )}
        {tab === "playbooks" && <TabPlaybooks versions={versions} />}
        {tab === "financeiro" && (
          <TabFinanceiro
            clinic={clinic}
            treatments={treatments}
            canEditPrices={canEditPrices}
            serviceNoun={serviceNoun}
            campaigns={campaigns}
            hasPriceCampaigns={hasPriceCampaigns}
          />
        )}
      </div>
    </div>
  );
}
