"use client";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { Zap, Sparkles, MessageSquare, GripVertical, Lock } from "lucide-react";
import { toggleAutoReply } from "./actions";
import { updateClinicOperationalSettings } from "./playbook-version-actions";
import type { MenuItem, MenuItemIntent, ConversationExperience } from "@/domain/entities/clinic";
import { CONCIERGE_MENU_ITEMS, DEFAULT_MENU_ITEMS } from "@/domain/entities/clinic";
import { S, SettingsCard, SettingsToggle, SettingsBadge, SettingsTextarea, SaveStatus, IconBox } from "./settings-primitives";

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback((patch: { greetingMessage?: string; menuItems?: MenuItem[] }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await updateClinicOperationalSettings({
        greetingMessage: (patch.greetingMessage ?? greetingMessage) || null,
        menuItems: patch.menuItems ?? menuItems,
      });
      setSaving(false);
      setSaved(true);
    }, 1000);
  }, [greetingMessage, menuItems]);

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

  const menuPreview = menuItems.filter((i) => i.enabled).map((i) => `${i.number}. ${i.label}`).join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: S.sectionGap, maxWidth: "660px" }}>

      {/* Status da IA */}
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
                Recepcionista responde automaticamente via WhatsApp
              </p>
            </div>
          </div>
          <SettingsToggle checked={enabled} onChange={handleToggle} pending={togglePending} />
        </div>
      </SettingsCard>

      {/* Experiência da conversa */}
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
              <p style={{ margin: "3px 0 0", fontSize: "11px", color: conciergeModuleActive ? S.teal : S.textMuted }}>
                {conciergeModuleActive ? "Modo concierge ativo no seu plano." : "Para alterar o modo, fale com o suporte."}
              </p>
            </div>
          </div>
          {!conciergeModuleActive && <Lock size={14} style={{ color: S.textMuted, flexShrink: 0 }} />}
        </div>
      </SettingsCard>

      {/* Texto de boas-vindas */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <IconBox>
            <MessageSquare size={14} strokeWidth={1.8} />
          </IconBox>
          <div>
            <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Texto de boas-vindas</p>
            <p style={{ margin: "1px 0 0", fontSize: S.fs.desc, color: S.textSec }}>
              Introdução do menu — deixe vazio para usar o texto padrão da IA
            </p>
          </div>
        </div>
        <SettingsTextarea
          value={greetingMessage}
          onChange={(e) => {
            setGreetingMessage(e.target.value);
            triggerSave({ greetingMessage: e.target.value });
          }}
          placeholder={`Olá! Sou a assistente virtual da ${clinic.name ?? "clínica"}. Como posso ajudá-lo?`}
          rows={3}
        />
      </div>

      {/* Menu de opções */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Menu de opções</p>
        <p style={{ margin: 0, fontSize: S.fs.desc, color: S.textSec }}>
          Edite os rótulos ou desative itens que não se aplicam à sua clínica
        </p>
        <MenuEditor items={menuItems} onChange={handleMenuChange} />

        {/* WhatsApp preview */}
        <div style={{
          background: "rgba(0,224,178,0.03)",
          border: `1px solid rgba(0,224,178,0.1)`,
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <p style={{ margin: "0 0 6px", fontSize: "10px", fontWeight: 700, color: S.textMuted, letterSpacing: "0.08em" }}>
            PRÉVIA NO WHATSAPP
          </p>
          <p style={{ margin: "0 0 3px", fontSize: "12px", color: S.textSec, fontStyle: "italic", lineHeight: 1.4 }}>
            {greetingMessage || `Seja bem-vindo à ${clinic.name ?? "clínica"}. Como posso ajudá-lo?`}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: S.text, whiteSpace: "pre-line", lineHeight: 1.7 }}>
            {menuPreview}
          </p>
        </div>
      </div>

      <SaveStatus saving={saving} saved={saved} />
    </div>
  );
}
