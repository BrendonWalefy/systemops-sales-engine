"use client";
import { useState, useTransition, useRef, useCallback } from "react";
import { Zap, Sparkles, MessageSquare, GripVertical, Lock } from "lucide-react";
import { toggleAutoReply } from "./actions";
import { updateClinicOperationalSettings } from "./playbook-version-actions";
import type { MenuItem, MenuItemIntent, ConversationExperience } from "@/domain/entities/clinic";
import { CONCIERGE_MENU_ITEMS, DEFAULT_MENU_ITEMS } from "@/domain/entities/clinic";
import { S, SettingsCard, SettingsToggle, SettingsBadge, SettingsTextarea, SaveStatus, IconBox, SLabel } from "./settings-primitives";
import { useReliableAutosave } from "./use-reliable-autosave";

export type SettingsFocusTarget = "takeover" | "buffer" | "hours";

type ClinicData = {
  name: string | null;
  autoReplyEnabled: boolean | null;
  greetingMessage: string | null;
  menuItems: MenuItem[] | null;
  activeModules: { key: string; config?: Record<string, unknown> | null }[];
};

const INTENT_LABELS: Record<MenuItemIntent, string> = {
  procedures: "Procedimentos",
  book_appointment: "Agendamento",
  price_inquiry: "Preços / Pagamento",
  location: "Localização",
  needs_human: "Falar com especialista",
};

function defaultMenuItemsForExperience(experience: ConversationExperience): MenuItem[] {
  return experience === "concierge" ? CONCIERGE_MENU_ITEMS : DEFAULT_MENU_ITEMS;
}

function MenuEditor({ items, onChange }: { items: MenuItem[]; onChange: (items: MenuItem[]) => void }) {
  function updateLabel(index: number, label: string) {
    onChange(items.map((item, i) => (i === index ? { ...item, label } : item)));
  }
  function toggleEnabled(index: number) {
    onChange(items.map((item, i) => (i === index ? { ...item, enabled: !item.enabled } : item)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {items.map((item, i) => (
        <div
          key={item.number}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: item.enabled ? "rgba(0,224,178,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${item.enabled ? "rgba(0,224,178,0.12)" : S.border}`,
            borderRadius: "8px",
            padding: "9px 12px",
            transition: "all 150ms",
          }}
        >
          <GripVertical size={13} style={{ color: S.textMuted, flexShrink: 0 }} />
          <span style={{
            width: "20px", height: "20px", borderRadius: "5px",
            background: item.enabled ? "rgba(0,224,178,0.1)" : S.card,
            border: `1px solid ${item.enabled ? "rgba(0,224,178,0.2)" : S.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "10px", fontWeight: 700,
            color: item.enabled ? S.teal : S.textMuted,
            flexShrink: 0,
          }}>
            {item.number}
          </span>
          <input
            value={item.label}
            onChange={(e) => updateLabel(i, e.target.value)}
            disabled={!item.enabled}
            style={{
              flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
              color: item.enabled ? S.text : S.textMuted,
              fontSize: "14px", fontFamily: "inherit",
            }}
          />
          <span className="menu-intent-label" style={{ fontSize: "10px", color: S.textMuted, flexShrink: 0 }}>
            {INTENT_LABELS[item.intent]}
          </span>
          <button
            type="button"
            onClick={() => toggleEnabled(i)}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px", flexShrink: 0 }}
          >
            <div style={{
              width: "28px", height: "16px", borderRadius: "8px",
              background: item.enabled ? S.teal : "rgba(255,255,255,0.1)",
              position: "relative", transition: "background 200ms",
            }}>
              <span style={{
                position: "absolute", top: "2px", left: item.enabled ? "14px" : "2px",
                width: "12px", height: "12px", borderRadius: "50%",
                background: "#fff", transition: "left 200ms",
              }} />
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}

export function TabGeral({ clinic }: { clinic: ClinicData }) {
  const conciergeModuleActive = clinic.activeModules.some((m) => m.key === "concierge_mode");
  const derivedExperience: ConversationExperience = conciergeModuleActive ? "concierge" : "menu_first";

  const [enabled, setEnabled] = useState(clinic.autoReplyEnabled ?? false);
  const [togglePending, startToggleTransition] = useTransition();
  const customMenuRef = useRef(clinic.menuItems !== null);
  const [greetingMessage, setGreetingMessage] = useState(clinic.greetingMessage ?? "");
  const [menuItems, setMenuItems] = useState<MenuItem[]>(clinic.menuItems ?? defaultMenuItemsForExperience(derivedExperience));
  const { scheduleSave, saving, saved, pending, error } = useReliableAutosave<{
    greetingMessage: string | null;
    menuItems: MenuItem[];
  }>({
    delayMs: 1000,
    save: updateClinicOperationalSettings,
  });

  const triggerSave = useCallback((patch: { greetingMessage?: string; menuItems?: MenuItem[] }) => {
    scheduleSave({
      greetingMessage: (patch.greetingMessage ?? greetingMessage) || null,
      menuItems: patch.menuItems ?? menuItems,
    });
  }, [greetingMessage, menuItems, scheduleSave]);

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startToggleTransition(async () => { await toggleAutoReply(!next); });
  }

  function handleMenuChange(next: MenuItem[]) {
    customMenuRef.current = true;
    setMenuItems(next);
    triggerSave({ menuItems: next });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "660px" }}>

      {/* COMPORTAMENTO */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <SLabel>Comportamento</SLabel>

        <SettingsCard>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <IconBox>
                <Zap size={15} strokeWidth={1.8} />
              </IconBox>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Status da IA</strong>
                  <SettingsBadge variant={enabled ? "active" : "locked"}>
                    {enabled ? "Ativa" : "Pausada"}
                  </SettingsBadge>
                  {enabled && (
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: S.teal, display: "inline-block" }} />
                      <span style={{ fontSize: "11px", color: S.teal, fontWeight: 500 }}>IA Online</span>
                    </div>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
                  Responde automaticamente no WhatsApp
                </p>
              </div>
            </div>
            <SettingsToggle checked={enabled} onChange={handleToggle} pending={togglePending} />
          </div>
        </SettingsCard>

        <SettingsCard>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <IconBox active={conciergeModuleActive}>
                <Sparkles size={15} strokeWidth={1.8} />
              </IconBox>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Experiência da conversa</strong>
                  <SettingsBadge variant="active">
                    {conciergeModuleActive ? "Concierge" : "Menu-first"}
                  </SettingsBadge>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
                  {conciergeModuleActive ? "IA conversa naturalmente, sem menu" : "IA apresenta menu de opções ao lead"}
                </p>
              </div>
            </div>
            {!conciergeModuleActive && <Lock size={14} style={{ color: S.textMuted, flexShrink: 0 }} />}
          </div>
        </SettingsCard>
      </div>

      {/* BOAS-VINDAS */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <SLabel style={{ margin: 0 }}>Boas-vindas</SLabel>
          <span style={{ fontSize: "11px", color: S.textMuted }}>Opcional</span>
        </div>
        <SettingsCard>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
            <MessageSquare size={14} strokeWidth={1.8} style={{ color: S.textMuted }} />
            <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Texto de boas-vindas</p>
          </div>
          <SettingsTextarea
            value={greetingMessage}
            onChange={(e) => {
              setGreetingMessage(e.target.value);
              triggerSave({ greetingMessage: e.target.value });
            }}
            placeholder={`Olá! Sou a especialista comercial com IA da ${clinic.name ?? "empresa"}. Como posso ajudar?`}
            rows={3}
          />
        </SettingsCard>
      </div>

      {/* MENU DE OPÇÕES */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <SLabel style={{ margin: 0 }}>Menu de opções</SLabel>
          <span style={{ fontSize: "11px", color: S.textMuted }}>arraste p/ ordenar</span>
        </div>
        <SettingsCard style={{ padding: "12px" }}>
          <MenuEditor items={menuItems} onChange={handleMenuChange} />
        </SettingsCard>
      </div>

      <SaveStatus saving={saving} saved={saved} pending={pending} error={error} />
    </div>
  );
}
