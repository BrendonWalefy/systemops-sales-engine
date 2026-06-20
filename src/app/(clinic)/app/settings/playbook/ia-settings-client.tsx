"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Timer, CalendarClock, Clock, FlaskConical, MoreHorizontal, Plus, Edit2, Copy, Trash2, Check, Pencil, Zap, MessageSquare, GripVertical, Phone, Sparkles, Mic, Lock } from "lucide-react";
import {
  activatePlaybookVersion,
  renamePlaybookVersion,
  duplicatePlaybookVersion,
  deletePlaybookVersion,
  createPlaybookVersion,
  updateClinicOperationalSettings,
  updateVoiceModuleConfig,
  updateBWaveConfig,
  updateBWaveSpeed,
} from "./playbook-version-actions";
import { VOICE_MODE_LABELS, type VoiceMode } from "@/domain/entities/voice-mode";
import type { VoiceElevenLabsConfig } from "@/application/modules/module-configs";
import { toggleAutoReply } from "./actions";
import type { ConversationExperience, MenuItem, MenuItemIntent } from "@/domain/entities/clinic";
import { CONCIERGE_MENU_ITEMS, DEFAULT_MENU_ITEMS } from "@/domain/entities/clinic";
import { TTS_SPEED_DEFAULTS } from "@/domain/entities/tts-config";
import type { TtsProvider } from "@/domain/entities/tts-config";
import type { Treatment } from "@/domain/entities/treatment";
import { TreatmentRow } from "../tratamentos/TreatmentRow";
import { AddTreatmentForm } from "../tratamentos/AddTreatmentForm";
import type { ActiveModule } from "@/application/modules/module-gate";

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
  slotLookaheadDays: number | null;
  mediaTakeoverTtlHours: number | null;
  installmentRates: { n: number; rate: number; active: boolean }[] | null;
  activeModules: ActiveModule[];
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

type Tab = "geral" | "playbooks" | "procedimentos" | "financeiro";
type SettingsFocusTarget = "takeover" | "buffer" | "hours";

function timeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "agora";
  if (mins < 60) return `há ${mins}min`;
  if (hours < 24) return `há ${hours}h`;
  if (days < 30) return `há ${days}d`;
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: Version["status"] }) {
  const cfg: Record<Version["status"], { label: string; style: React.CSSProperties }> = {
    active: {
      label: "Em Produção",
      style: { background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" },
    },
    draft: {
      label: "Draft",
      style: { background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" },
    },
    historical: {
      label: "Histórico",
      style: { background: "rgba(255,255,255,0.05)", color: "#71717a", border: "1px solid rgba(255,255,255,0.08)" },
    },
  };
  const { label, style } = cfg[status];
  return (
    <span
      style={{
        ...style,
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "3px 10px",
        borderRadius: "6px",
        display: "inline-block",
      }}
    >
      {label}
    </span>
  );
}

function ContextMenu({
  version,
  onClose,
  onRename,
}: {
  version: Version;
  onClose: () => void;
  onRename: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: "36px",
        right: "8px",
        zIndex: 50,
        background: "#1c1c1f",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "10px",
        padding: "4px",
        minWidth: "160px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <button onClick={() => { onRename(); onClose(); }} style={menuItemStyle}>
        <Pencil size={14} /> Renomear
      </button>
      <button
        onClick={() => startTransition(async () => { await duplicatePlaybookVersion(version.id); onClose(); })}
        disabled={isPending}
        style={menuItemStyle}
      >
        <Copy size={14} /> Duplicar
      </button>
      {version.status !== "active" && (
        <>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <button
            onClick={() => startTransition(async () => { await deletePlaybookVersion(version.id); onClose(); })}
            disabled={isPending}
            style={{ ...menuItemStyle, color: "#f87171" }}
          >
            <Trash2 size={14} /> Excluir
          </button>
        </>
      )}
    </div>
  );
}

function VersionCard({ version, index }: { version: Version; index: number }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(version.name);
  const [isPending, startTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  function handleRenameSubmit() {
    if (!newName.trim() || newName === version.name) { setRenaming(false); return; }
    startTransition(async () => { await renamePlaybookVersion(version.id, newName.trim()); setRenaming(false); });
  }

  return (
    <div
      style={{
        background: "#141416",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        padding: "20px 20px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minHeight: "190px",
        position: "relative",
        transition: "border-color 150ms",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#52525b" }}>{index + 1}</span>
          <StatusBadge status={version.status} />
        </div>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", padding: "4px", borderRadius: "6px", display: "flex", alignItems: "center" }}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && <ContextMenu version={version} onClose={() => setMenuOpen(false)} onRename={() => setRenaming(true)} />}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {renaming ? (
          <input
            ref={renameRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); if (e.key === "Escape") setRenaming(false); }}
            style={{ background: "transparent", border: "none", borderBottom: "1px solid rgba(16,185,129,0.5)", color: "#fafafa", fontSize: "16px", fontWeight: 700, width: "100%", outline: "none", padding: "2px 0" }}
          />
        ) : (
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fafafa", lineHeight: 1.3 }}>{version.name}</h3>
        )}
        <p style={{ margin: "5px 0 0", fontSize: "11px", color: "#52525b" }}>Editado {timeAgo(version.updatedAt)}</p>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => router.push(`/app/settings/playbook/${version.id}`)}
          style={outlineBtnStyle}
        >
          <Edit2 size={12} />
          {version.status === "active" ? "Editar Contexto" : "Editar"}
        </button>
        {version.status === "active" ? (
          <button style={activeBtnStyle} disabled>
            <Check size={12} strokeWidth={2.5} /> Em produção
          </button>
        ) : (
          <button
            onClick={() => startTransition(async () => { await activatePlaybookVersion(version.id); })}
            disabled={isPending}
            style={primaryBtnStyle}
          >
            Ativar
          </button>
        )}
      </div>
    </div>
  );
}

function NewVersionCard() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  function handleSubmit() {
    if (!name.trim()) { setCreating(false); return; }
    startTransition(async () => { await createPlaybookVersion(name.trim()); setName(""); setCreating(false); });
  }

  return (
    <div
      onClick={() => !creating && !isPending && setCreating(true)}
      style={{
        background: "transparent",
        border: "1px dashed rgba(255,255,255,0.1)",
        borderRadius: "14px",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        minHeight: "190px",
        cursor: creating || isPending ? "default" : "pointer",
        transition: "border-color 150ms",
      }}
      onMouseEnter={(e) => !creating && ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.2)")}
      onMouseLeave={(e) => !creating && ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.1)")}
    >
      {creating ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do playbook..."
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { setCreating(false); setName(""); } }}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "8px", color: "#fafafa", fontSize: "16px", padding: "10px 12px", width: "100%", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} disabled={isPending} style={{ ...primaryBtnStyle, flex: 1 }}>Criar</button>
            <button onClick={() => { setCreating(false); setName(""); }} style={{ ...outlineBtnStyle, flex: "none", padding: "8px 12px" }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#52525b" }}>
            <Plus size={18} />
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#52525b" }}>Criar nova versão</p>
        </>
      )}
    </div>
  );
}

function MenuEditor({
  items,
  onChange,
}: {
  items: MenuItem[];
  onChange: (items: MenuItem[]) => void;
}) {
  function updateLabel(index: number, label: string) {
    const next = items.map((item, i) => (i === index ? { ...item, label } : item));
    onChange(next);
  }

  function toggleEnabled(index: number) {
    const next = items.map((item, i) => (i === index ? { ...item, enabled: !item.enabled } : item));
    onChange(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {items.map((item, i) => (
        <div
          key={item.intent}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: item.enabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
            border: `1px solid ${item.enabled ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)"}`,
            borderRadius: "8px",
            padding: "10px 12px",
            transition: "all 150ms",
          }}
        >
          <GripVertical size={14} style={{ color: "#3f3f46", flexShrink: 0 }} />
          <span style={{
            width: "22px",
            height: "22px",
            borderRadius: "6px",
            background: item.enabled ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${item.enabled ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            fontWeight: 700,
            color: item.enabled ? "#34d399" : "#3f3f46",
            flexShrink: 0,
          }}>
            {item.number}
          </span>
          <input
            value={item.label}
            onChange={(e) => updateLabel(i, e.target.value)}
            disabled={!item.enabled}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: item.enabled ? "#e4e4e7" : "#52525b",
              fontSize: "16px",
              fontFamily: "inherit",
              lineHeight: 1.35,
            }}
          />
          <span className="menu-intent-label" style={{ fontSize: "10px", color: "#3f3f46", flexShrink: 0, minWidth: "100px", textAlign: "right" }}>
            {INTENT_LABELS[item.intent]}
          </span>
          <button
            onClick={() => toggleEnabled(i)}
            title={item.enabled ? "Desativar item" : "Ativar item"}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: item.enabled ? "#34d399" : "#3f3f46",
              display: "flex",
              alignItems: "center",
              padding: "2px",
              flexShrink: 0,
            }}
          >
            <div style={{
              width: "28px",
              height: "16px",
              borderRadius: "8px",
              background: item.enabled ? "#10b981" : "rgba(255,255,255,0.08)",
              position: "relative",
              transition: "background 200ms",
              flexShrink: 0,
            }}>
              <span style={{
                position: "absolute",
                top: "2px",
                left: item.enabled ? "14px" : "2px",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#fff",
                transition: "left 200ms",
              }} />
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}

function GeralTab({
  clinic,
  focusTarget,
  onFocusHandled,
}: {
  clinic: ClinicData;
  focusTarget: SettingsFocusTarget | null;
  onFocusHandled: () => void;
}) {
  // Deriva estado de módulos
  const voiceMod = clinic.activeModules.find((m) => m.key === "voice_tts");
  const voiceModuleActive = !!voiceMod;
  const bwaveMod = clinic.activeModules.find((m) => m.key === "voice_elevenlabs");
  const bwaveActive = !!bwaveMod;
  const audioResponseActive = voiceModuleActive || bwaveActive;
  const bwaveConfig = bwaveMod?.config as VoiceElevenLabsConfig | null | undefined;
  const bwaveMode: VoiceMode = bwaveConfig?.mode ?? "impact";
  const conciergeModuleActive = clinic.activeModules.some((m) => m.key === "concierge_mode");
  const derivedExperience: ConversationExperience = conciergeModuleActive ? "concierge" : "menu_first";

  const [enabled, setEnabled] = useState(clinic.autoReplyEnabled ?? false);
  const [togglePending, startToggleTransition] = useTransition();
  const [bwaveDraft, setBwaveDraft] = useState<VoiceElevenLabsConfig>({
    voiceId: bwaveConfig?.voiceId ?? "",
    stability: bwaveConfig?.stability ?? 0.5,
    similarityBoost: bwaveConfig?.similarityBoost ?? 0.75,
    speed: bwaveConfig?.speed ?? 1.0,
    mode: bwaveConfig?.mode ?? "impact",
  });
  const [bwaveSpeed, setBwaveSpeed] = useState(bwaveConfig?.speed ?? 1.0);
  const [bwaveSpeedPending, startBwaveSpeedTransition] = useTransition();
  const [bwaveConfigPending, startBwaveConfigTransition] = useTransition();

  function handleBwaveSpeedChange(speed: number) {
    setBwaveSpeed(speed);
    setBwaveDraft((current) => ({ ...current, speed }));
    startBwaveSpeedTransition(async () => { await updateBWaveSpeed(speed); });
  }

  function handleSaveBwaveConfig() {
    startBwaveConfigTransition(async () => {
      await updateBWaveConfig(bwaveDraft);
    });
  }

  const [ttsConfig, setTtsConfig] = useState<{ provider: string; speed: number }>(
    voiceMod?.config
      ? { provider: (voiceMod.config.provider as string) ?? "nova", speed: Number(voiceMod.config.speed ?? 1.0) }
      : { provider: "nova", speed: TTS_SPEED_DEFAULTS.nova },
  );
  const [ttsConfigPending, startTtsConfigTransition] = useTransition();

  const customMenuRef = useRef(clinic.menuItems !== null);
  const [greetingMessage, setGreetingMessage] = useState(clinic.greetingMessage ?? "");
  const [menuItems, setMenuItems] = useState<MenuItem[]>(clinic.menuItems ?? defaultMenuItemsForExperience(derivedExperience));
  const [businessHours, setBusinessHours] = useState(clinic.businessHours ?? "");
  const [receptionistPhone, setReceptionistPhone] = useState(clinic.receptionistPhone ?? "");
  const [takeoverTtlHours, setTakeoverTtlHours] = useState(clinic.takeoverTtlHours ?? 4);
  const [postAppointmentBufferMinutes, setPostAppointmentBufferMinutes] = useState(clinic.postAppointmentBufferMinutes ?? 60);
  const [staleConversationHours, setStaleConversationHours] = useState(clinic.staleConversationHours ?? 4);
  const [slotLookaheadDays, setSlotLookaheadDays] = useState(clinic.slotLookaheadDays ?? 14);
  const [mediaTakeoverTtlHours, setMediaTakeoverTtlHours] = useState(clinic.mediaTakeoverTtlHours ?? 0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const businessHoursSectionRef = useRef<HTMLDivElement>(null);
  const takeoverSectionRef = useRef<HTMLDivElement>(null);
  const bufferSectionRef = useRef<HTMLDivElement>(null);
  const businessHoursInputRef = useRef<HTMLInputElement>(null);
  const takeoverInputRef = useRef<HTMLInputElement>(null);
  const bufferInputRef = useRef<HTMLInputElement>(null);

  function handleTtsProviderChange(provider: TtsProvider) {
    const next = { provider, speed: TTS_SPEED_DEFAULTS[provider] };
    setTtsConfig(next);
    startTtsConfigTransition(async () => {
      await updateVoiceModuleConfig(next);
    });
  }

  function handleTtsSpeedChange(speed: number) {
    const next = { ...(ttsConfig as { provider: TtsProvider; speed: number }), speed };
    setTtsConfig(next);
    startTtsConfigTransition(async () => {
      await updateVoiceModuleConfig(next);
    });
  }

  const triggerSave = useCallback((patch: {
    greetingMessage?: string;
    menuItems?: MenuItem[];
    businessHours?: string;
    takeoverTtlHours?: number;
    postAppointmentBufferMinutes?: number;
    receptionistPhone?: string;
    staleConversationHours?: number;
    slotLookaheadDays?: number;
    mediaTakeoverTtlHours?: number;
  }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await updateClinicOperationalSettings({
        greetingMessage: (patch.greetingMessage ?? greetingMessage) || null,
        menuItems: patch.menuItems ?? menuItems,
        businessHours: (patch.businessHours ?? businessHours) || null,
        takeoverTtlHours: patch.takeoverTtlHours ?? takeoverTtlHours,
        postAppointmentBufferMinutes: patch.postAppointmentBufferMinutes ?? postAppointmentBufferMinutes,
        receptionistPhone: (patch.receptionistPhone ?? receptionistPhone) || null,
        staleConversationHours: patch.staleConversationHours ?? staleConversationHours,
        slotLookaheadDays: patch.slotLookaheadDays ?? slotLookaheadDays,
        mediaTakeoverTtlHours: (() => {
          const value = patch.mediaTakeoverTtlHours ?? mediaTakeoverTtlHours;
          return value > 0 ? value : null;
        })(),
      });
      setSaving(false);
      setSaved(true);
    }, 1200);
  }, [greetingMessage, menuItems, businessHours, takeoverTtlHours, postAppointmentBufferMinutes, receptionistPhone, staleConversationHours, slotLookaheadDays, mediaTakeoverTtlHours]);

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

  useEffect(() => {
    if (!focusTarget) return;

    const target = {
      hours: { section: businessHoursSectionRef.current, input: businessHoursInputRef.current },
      takeover: { section: takeoverSectionRef.current, input: takeoverInputRef.current },
      buffer: { section: bufferSectionRef.current, input: bufferInputRef.current },
    }[focusTarget];

    target.section?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => {
      target.input?.focus();
      if (target.input && target.input.type !== "number") target.input.select();
      onFocusHandled();
    }, 220);

    return () => clearTimeout(timer);
  }, [focusTarget, onFocusHandled]);

  const menuPreview = menuItems
    .filter(i => i.enabled)
    .map(i => `${i.number}. ${i.label}`)
    .join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "680px" }}>

      {/* Status da IA */}
      <div className="ia-status-card" style={cardStyle}>
        <div className="ia-status-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "14px" }}>
          <div className="ia-status-main" style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
            <div style={iconBoxStyle}>
              <Zap size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Status da IA</strong>
                <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", ...(enabled ? { background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" } : { background: "rgba(255,255,255,0.05)", color: "#71717a", border: "1px solid rgba(255,255,255,0.08)" }) }}>
                  {enabled ? "Ativa" : "Pausada"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>Recepcionista responde automaticamente via WhatsApp</p>
            </div>
          </div>
          <div className="ia-status-actions" style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
            {enabled && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
                <span style={{ fontSize: "12px", color: "#34d399", fontWeight: 500 }}>IA Online</span>
              </div>
            )}
            <button onClick={handleToggle} disabled={togglePending} style={{ width: "44px", height: "24px", borderRadius: "12px", border: "none", background: enabled ? "#10b981" : "rgba(255,255,255,0.1)", cursor: togglePending ? "default" : "pointer", position: "relative", transition: "background 200ms", flexShrink: 0, opacity: togglePending ? 0.7 : 1 }}>
              <span style={{ position: "absolute", top: "3px", left: enabled ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", transition: "left 200ms" }} />
            </button>
          </div>
        </div>
      </div>

      {/* Resposta por voz */}
      <div className="ia-status-card" style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
          <div className="ia-status-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "14px" }}>
            <div className="ia-status-main" style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
              <div style={iconBoxStyle}>
                <Mic size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Resposta por Voz</strong>
                  <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", ...(audioResponseActive ? { background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" } : { background: "rgba(255,255,255,0.05)", color: "#71717a", border: "1px solid rgba(255,255,255,0.08)" }) }}>
                    {audioResponseActive ? "Ativa" : "Inativa"}
                  </span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>
                  {bwaveActive
                    ? "B-WAVE Voice está ativa e tem prioridade sobre a voz básica."
                    : voiceModuleActive
                      ? "IA envia áudios de voz em vez de texto."
                      : "Para ativar este módulo, fale com o suporte."}
                </p>
              </div>
            </div>
            {!audioResponseActive && <Lock size={14} style={{ color: "#3f3f46", flexShrink: 0 }} />}
          </div>

        {voiceModuleActive && !bwaveActive && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Seletor de provider — empilhado, funciona em qualquer largura */}
            <div>
              <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Voz</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {([
                  { id: "nova" as TtsProvider, label: "Nova", description: "OpenAI · EN-native", badge: "Padrão" },
                  { id: "neural2" as TtsProvider, label: "Neural2", description: "Google · PT-BR Neural2", badge: "Novo" },
                ]).map((opt) => {
                  const selected = ttsConfig.provider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={ttsConfigPending}
                      onClick={() => handleTtsProviderChange(opt.id)}
                      style={{
                        display: "flex", flexDirection: "row", alignItems: "center",
                        justifyContent: "space-between", gap: "8px",
                        padding: "9px 12px", borderRadius: "8px", border: "none", width: "100%",
                        cursor: ttsConfigPending ? "default" : "pointer", textAlign: "left",
                        opacity: ttsConfigPending ? 0.7 : 1, transition: "background 150ms",
                        background: selected ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.04)",
                        outline: selected ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? "#34d399" : "#fafafa", flexShrink: 0 }}>{opt.label}</span>
                        <span style={{ fontSize: "11px", color: "#52525b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.description}</span>
                      </div>
                      <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 7px", borderRadius: "4px", flexShrink: 0, background: selected ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.07)", color: selected ? "#34d399" : "#52525b" }}>{opt.badge}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slider de velocidade */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <p style={{ margin: 0, fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Velocidade</p>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
                  {ttsConfig.speed.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.05}
                value={ttsConfig.speed}
                disabled={ttsConfigPending}
                onChange={(e) => handleTtsSpeedChange(Number(e.target.value))}
                onPointerUp={(e) => handleTtsSpeedChange(Number((e.target as HTMLInputElement).value))}
                style={{ width: "100%", accentColor: "#10b981", cursor: ttsConfigPending ? "default" : "pointer", touchAction: "none" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                <span style={{ fontSize: "10px", color: "#3f3f46" }}>lento</span>
                <span style={{ fontSize: "10px", color: "#3f3f46" }}>rápido</span>
              </div>
            </div>
          </div>
        )}

        {bwaveActive && !voiceModuleActive && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ margin: 0, fontSize: "11px", color: "#34d399", fontWeight: 600 }}>
              O áudio está sendo gerenciado pelo B-WAVE Voice abaixo.
            </p>
          </div>
        )}
        </div>
      </div>

      {/* B-WAVE Voice */}
      <div className="ia-status-card" style={{
        ...cardStyle,
        ...(bwaveActive
          ? { border: "1px solid rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.03)" }
          : { border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }),
      }}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
              <div style={{ ...iconBoxStyle, background: bwaveActive ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)" }}>
                {/* B-WAVE waveform icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: bwaveActive ? "#34d399" : "#52525b" }}>
                  <path d="M2 12 Q4 4, 6 12 Q8 20, 10 12 Q12 4, 14 12 Q16 20, 18 12 Q20 4, 22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "14px", fontWeight: 700, color: "#fafafa", letterSpacing: "-0.01em" }}>B-WAVE Voice</strong>
                  {bwaveActive ? (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                      {VOICE_MODE_LABELS[bwaveMode].label}
                    </span>
                  ) : (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
                      Plano Rede+
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>
                  {bwaveActive
                    ? VOICE_MODE_LABELS[bwaveMode].description
                    : "Voz hiper-realista que atende, converte e conquista — soa como uma recepcionista humana."}
                </p>
              </div>
            </div>
            {!bwaveActive && <Lock size={14} style={{ color: "#3f3f46", flexShrink: 0 }} />}
          </div>

          {/* Estado ativo — controles da clínica */}
          {bwaveActive && (
            <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid rgba(16,185,129,0.1)", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Voice ID</span>
                  <input
                    value={bwaveDraft.voiceId}
                    onChange={(e) => setBwaveDraft((current) => ({ ...current, voiceId: e.target.value }))}
                    placeholder="GM2UA3fbsIaLHcswCDX9"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fafafa", fontSize: "12px", padding: "8px 10px", fontFamily: "monospace" }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Stability</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bwaveDraft.stability}
                    onChange={(e) => setBwaveDraft((current) => ({ ...current, stability: Number(e.target.value) }))}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fafafa", fontSize: "12px", padding: "8px 10px" }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Similarity Boost</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bwaveDraft.similarityBoost}
                    onChange={(e) => setBwaveDraft((current) => ({ ...current, similarityBoost: Number(e.target.value) }))}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fafafa", fontSize: "12px", padding: "8px 10px" }}
                  />
                </label>
              </div>

              <div>
                <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Modo B-WAVE</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(["impact", "mix", "full"] as VoiceMode[]).map((mode) => {
                    const selected = bwaveDraft.mode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBwaveDraft((current) => ({ ...current, mode }))}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "10px",
                          padding: "10px 12px",
                          borderRadius: "8px",
                          border: selected ? "1px solid rgba(16,185,129,0.22)" : "1px solid rgba(255,255,255,0.06)",
                          background: selected ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ width: "8px", height: "8px", marginTop: "5px", borderRadius: "999px", background: selected ? "#34d399" : "#3f3f46", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "#fafafa" }}>{VOICE_MODE_LABELS[mode].label}</div>
                          <div style={{ fontSize: "11px", color: "#71717a", marginTop: "2px" }}>{VOICE_MODE_LABELS[mode].description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Speed slider */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#71717a", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Velocidade da voz</p>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
                    {bwaveSpeed.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.05}
                  value={bwaveSpeed}
                  disabled={bwaveSpeedPending}
                  onChange={(e) => handleBwaveSpeedChange(Number(e.target.value))}
                  onPointerUp={(e) => handleBwaveSpeedChange(Number((e.target as HTMLInputElement).value))}
                  style={{ width: "100%", accentColor: "#10b981", cursor: bwaveSpeedPending ? "default" : "pointer", touchAction: "none" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                  <span style={{ fontSize: "10px", color: "#3f3f46" }}>mais calma</span>
                  <span style={{ fontSize: "10px", color: "#3f3f46" }}>mais dinâmica</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleSaveBwaveConfig}
                  disabled={bwaveConfigPending}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "1px solid rgba(16,185,129,0.28)",
                    background: "rgba(16,185,129,0.08)",
                    color: "#34d399",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: bwaveConfigPending ? "default" : "pointer",
                    opacity: bwaveConfigPending ? 0.7 : 1,
                  }}
                >
                  {bwaveConfigPending ? "Salvando..." : "Salvar configuração B-WAVE"}
                </button>
              </div>
            </div>
          )}

          {/* Estado locked — teaser */}
          {!bwaveActive && (
            <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                "Voz responde leads quentes em áudio no WhatsApp",
                "Nota de voz nativa — aparece com waveform como humano",
                "IA decide quando usar voz para maximizar conversão",
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#3f3f46", flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", color: "#3f3f46" }}>{item}</span>
                </div>
              ))}
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#3f3f46" }}>
                Disponível no plano Rede. Fale com o suporte para ativar.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Experiência da conversa */}
      <div className="ia-status-card" style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
            <div style={iconBoxStyle}>
              <Sparkles size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Experiência da conversa</strong>
                <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                  {conciergeModuleActive ? "Concierge" : "Menu-first"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>
                {conciergeModuleActive ? "IA conversa naturalmente, sem menu" : "IA apresenta menu de opções ao lead"}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: conciergeModuleActive ? "#34d399" : "#3f3f46" }}>
                {conciergeModuleActive ? "Modo concierge liberado e ativo no seu plano." : "Para alterar o modo, fale com o suporte."}
              </p>
            </div>
          </div>
          {!conciergeModuleActive && <Lock size={14} style={{ color: "#3f3f46", flexShrink: 0 }} />}
        </div>
      </div>

      {/* Texto de boas-vindas */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="ia-section-heading" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={iconBoxStyle}>
            <MessageSquare size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Texto de boas-vindas</p>
            <p style={{ margin: "1px 0 0", fontSize: "12px", color: "#52525b" }}>Usado como introdução do menu quando a experiência permite menu</p>
          </div>
        </div>
        <textarea
          value={greetingMessage}
          onChange={(e) => {
            setGreetingMessage(e.target.value);
            triggerSave({ greetingMessage: e.target.value });
          }}
          placeholder={`Olá! Sou a assistente virtual da ${clinic.name ?? "clínica"}. Como posso ajudá-lo?`}
          rows={3}
          style={{ ...geralInputStyle, resize: "vertical" }}
        />
        <p style={{ margin: 0, fontSize: "11px", color: "#3f3f46" }}>
          Se vazio, usa o texto padrão da IA. No concierge, pergunta clara é respondida antes de qualquer menu.
        </p>
      </div>

      {/* Menu de opções */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="ia-section-heading" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={iconBoxStyle}>
            <Plus size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Menu de opções</p>
            <p style={{ margin: "1px 0 0", fontSize: "12px", color: "#52525b" }}>
              Itens exibidos ao lead. Edite os rótulos ou desative itens que não se aplicam à sua clínica.
            </p>
          </div>
        </div>

        <MenuEditor items={menuItems} onChange={handleMenuChange} />

        {/* Preview */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "14px 16px" }}>
          <p style={{ margin: "0 0 8px", fontSize: "10px", fontWeight: 700, color: "#3f3f46", letterSpacing: "0.08em" }}>PRÉVIA NO WHATSAPP</p>
          <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#52525b", fontStyle: "italic" }}>
            {greetingMessage || `Seja bem-vindo à ${clinic.name ?? "clínica"}. Como posso ajudá-lo?`}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "#a1a1aa", whiteSpace: "pre-line", lineHeight: 1.8 }}>{menuPreview}</p>
        </div>
      </div>

      {/* Horário de funcionamento */}
      <div ref={businessHoursSectionRef} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="ia-section-heading" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={iconBoxStyle}>
            <Clock size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Horário de funcionamento</p>
            <p style={{ margin: "1px 0 0", fontSize: "12px", color: "#52525b" }}>Usado pela IA ao informar leads e na lógica de agendamento</p>
          </div>
        </div>
        <input
          ref={businessHoursInputRef}
          type="text"
          value={businessHours}
          onChange={(e) => {
            setBusinessHours(e.target.value);
            triggerSave({ businessHours: e.target.value });
          }}
          placeholder="Ex: Segunda a sexta das 8h às 18h. Sábado das 8h às 13h."
          style={geralInputStyle}
        />
      </div>

      {/* Telefone da recepção */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="ia-section-heading" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={iconBoxStyle}>
            <Phone size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Telefone da recepção</p>
            <p style={{ margin: "1px 0 0", fontSize: "12px", color: "#52525b" }}>Número WhatsApp que recebe alertas quando a IA pede atenção humana</p>
          </div>
        </div>
        <input
          type="tel"
          value={receptionistPhone}
          onChange={(e) => {
            setReceptionistPhone(e.target.value);
            triggerSave({ receptionistPhone: e.target.value });
          }}
          placeholder="Ex: 5511999999999 (com código do país)"
          style={geralInputStyle}
        />
      </div>

      {/* Comportamento automático */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div className="ia-section-heading" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={iconBoxStyle}>
            <Timer size={15} strokeWidth={1.8} style={{ color: "#34d399" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Comportamento automático</p>
            <p style={{ margin: "1px 0 0", fontSize: "12px", color: "#52525b" }}>Controla quando a IA retoma e quanto tempo reserva entre atendimentos</p>
          </div>
        </div>
        <div className="ia-geral-grid" style={{ display: "grid", gap: "12px" }}>
          <div className="ia-number-card" ref={takeoverSectionRef} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#a1a1aa" }}>Pausa automática</p>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#52525b" }}>Horas até a IA retomar após atendimento humano</p>
            <div className="ia-number-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                ref={takeoverInputRef}
                type="number"
                value={takeoverTtlHours}
                min={0} max={72}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setTakeoverTtlHours(v);
                  triggerSave({ takeoverTtlHours: v });
                }}
                style={{ ...geralInputStyle, width: "80px" }}
              />
              <span style={{ fontSize: "13px", color: "#52525b" }}>horas</span>
            </div>
          </div>
          <div className="ia-number-card" ref={bufferSectionRef} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#a1a1aa" }}>Intervalo entre atendimentos</p>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#52525b" }}>Buffer de tempo reservado após cada agendamento</p>
            <div className="ia-number-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                ref={bufferInputRef}
                type="number"
                value={postAppointmentBufferMinutes}
                min={0} max={240} step={5}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setPostAppointmentBufferMinutes(v);
                  triggerSave({ postAppointmentBufferMinutes: v });
                }}
                style={{ ...geralInputStyle, width: "80px" }}
              />
              <span style={{ fontSize: "13px", color: "#52525b" }}>min</span>
            </div>
          </div>
          <div className="ia-number-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#a1a1aa" }}>Janela de agenda</p>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#52525b" }}>Quantos dias à frente a IA pode oferecer horários</p>
            <div className="ia-number-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                value={slotLookaheadDays}
                min={1} max={90}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1;
                  setSlotLookaheadDays(v);
                  triggerSave({ slotLookaheadDays: v });
                }}
                style={{ ...geralInputStyle, width: "80px" }}
              />
              <span style={{ fontSize: "13px", color: "#52525b" }}>dias</span>
            </div>
          </div>
          <div className="ia-number-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#a1a1aa" }}>Conversa parada</p>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#52525b" }}>Após esse tempo sem resposta do lead, a IA retoma como conversa nova</p>
            <div className="ia-number-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                value={staleConversationHours}
                min={1} max={72}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1;
                  setStaleConversationHours(v);
                  triggerSave({ staleConversationHours: v });
                }}
                style={{ ...geralInputStyle, width: "80px" }}
              />
              <span style={{ fontSize: "13px", color: "#52525b" }}>horas</span>
            </div>
          </div>
          <div className="ia-number-card" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 16px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#a1a1aa" }}>Retorno após mídia</p>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#52525b" }}>Horas até a IA retomar após foto, vídeo ou documento. Use 0 para deixar só no humano.</p>
            <div className="ia-number-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                value={mediaTakeoverTtlHours}
                min={0} max={72}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setMediaTakeoverTtlHours(v);
                  triggerSave({ mediaTakeoverTtlHours: v });
                }}
                style={{ ...geralInputStyle, width: "80px" }}
              />
              <span style={{ fontSize: "13px", color: "#52525b" }}>horas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Status de save */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#52525b" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: saving ? "#fbbf24" : saved ? "#10b981" : "#3f3f46", flexShrink: 0, display: "inline-block" }} />
        {saving ? "Salvando..." : saved ? "Configurações salvas" : "Alterações salvas automaticamente"}
      </div>
    </div>
  );
}

function ProcedimentosTab({ treatments, canEditPrices, serviceNoun }: { treatments: Treatment[]; canEditPrices: boolean; serviceNoun: string }) {
  const serviceNounPl = `${serviceNoun}s`;
  const serviceNounCapitalized = serviceNoun.charAt(0).toUpperCase() + serviceNoun.slice(1);
  return (
    <div style={{ maxWidth: "760px", display: "grid", gap: "24px" }}>
      <section
        style={{
          border: "1px solid var(--line, rgba(255,255,255,0.07))",
          borderRadius: "14px",
          background: "var(--surface-soft, #0d0d0f)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "18px 22px",
            borderBottom: "1px solid var(--line, rgba(255,255,255,0.07))",
          }}
        >
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: "40px",
              height: "40px",
              flexShrink: 0,
              borderRadius: "10px",
              border: "1px solid var(--line, rgba(255,255,255,0.07))",
              background: "rgba(16,185,129,0.07)",
              color: "#34d399",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
            </svg>
          </div>
          <div>
            <strong style={{ fontSize: "15px", fontWeight: 700, color: "#fafafa" }}>
              {serviceNounCapitalized}s cadastrados
            </strong>
            <p style={{ margin: "3px 0 0", fontSize: "13px", color: "#52525b" }}>
              {treatments.length === 0
                ? `Nenhum ${serviceNoun} cadastrado ainda`
                : `${treatments.length} ${treatments.length !== 1 ? serviceNounPl : serviceNoun} · edite e salve inline`}
            </p>
          </div>
        </div>

        {treatments.length === 0 ? (
          <div style={{ padding: "32px 22px", textAlign: "center", color: "#52525b", fontSize: "14px" }}>
            Adicione o primeiro {serviceNoun} abaixo
          </div>
        ) : (
          <div style={{ display: "grid" }}>
            {treatments.map((t, idx) => (
              <TreatmentRow
                key={t.id}
                treatment={t}
                isLast={idx === treatments.length - 1}
                canEditPrices={canEditPrices}
                serviceNoun={serviceNoun}
              />
            ))}
          </div>
        )}
      </section>

      <AddTreatmentForm canEditPrices={canEditPrices} serviceNoun={serviceNoun} />

      <div className="automation-note">
        <div className="automation-header">
          <Clock size={14} strokeWidth={2} />
          <strong style={{ fontSize: "12.5px", fontWeight: 700 }}>Duração padrão</strong>
        </div>
        <p>
          Quando o lead não especificar um procedimento ou for o primeiro contato, a IA usará a duração
          padrão configurada em Agendamento. Procedimentos cadastrados aqui têm prioridade sobre o padrão.
        </p>
      </div>
    </div>
  );
}

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
  { n: 13, rate: 0,     active: false },
  { n: 14, rate: 0,     active: false },
  { n: 15, rate: 0,     active: false },
  { n: 16, rate: 0,     active: false },
  { n: 17, rate: 0,     active: false },
  { n: 18, rate: 0,     active: false },
  { n: 19, rate: 0,     active: false },
  { n: 20, rate: 0,     active: false },
  { n: 21, rate: 0,     active: false },
  { n: 22, rate: 0,     active: false },
  { n: 23, rate: 0,     active: false },
  { n: 24, rate: 0,     active: false },
];

function calcPreview(principal: number, rate: number, n: number): string {
  if (rate <= 0 || n <= 0) return "—";
  const val = Math.ceil(principal / (1 - rate / 100) / n);
  return `R$${val.toLocaleString("pt-BR")}`;
}

function FinanceiroTab({ clinic }: { clinic: ClinicData }) {
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
    <div style={{ maxWidth: "720px", display: "flex", flexDirection: "column", gap: "28px" }}>

      {/* Header + preview input */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700, color: "#fafafa" }}>Parcelamento</h2>
          <p style={{ margin: 0, fontSize: "13px", color: "#52525b" }}>
            Configure as taxas da sua maquininha. A IA apresenta os valores já com taxa embutida.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{ fontSize: "12px", color: "#52525b" }}>Simular para</span>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "12px", color: "#71717a" }}>R$</span>
            <input
              type="text"
              inputMode="numeric"
              value={previewInput}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "");
                const num = parseInt(raw) || 0;
                setPreviewValue(num);
                setPreviewInput(num.toLocaleString("pt-BR"));
              }}
              style={{ ...geralInputStyle, width: "110px", paddingLeft: "28px", fontSize: "13px", padding: "7px 10px 7px 26px" }}
            />
          </div>
        </div>
      </div>

      {/* Grade 1x–12x */}
      <div>
        <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, color: "#3f3f46", letterSpacing: "0.07em" }}>ATÉ 12x — OPERADORA ATUAL</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px" }}>
          {current12.map((row) => (
            <div
              key={row.n}
              style={{
                background: row.active ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${row.active ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: "12px",
                padding: "14px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                transition: "all 150ms",
              }}
            >
              {/* Número da parcela + toggle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "18px", fontWeight: 700, color: row.active ? "#fafafa" : "#52525b" }}>
                  {row.n}x
                </span>
                <button
                  onClick={() => updateRow(row.n, { active: !row.active })}
                  style={{
                    width: "32px", height: "18px", borderRadius: "9px", border: "none",
                    background: row.active ? "#10b981" : "rgba(255,255,255,0.1)",
                    cursor: "pointer", position: "relative", transition: "background 200ms", flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: "absolute", top: "3px",
                    left: row.active ? "16px" : "3px",
                    width: "12px", height: "12px", borderRadius: "50%",
                    background: "#fff", transition: "left 200ms",
                  }} />
                </button>
              </div>

              {/* Taxa */}
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.rate === 0 ? "" : String(row.rate).replace(".", ",")}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9,]/g, "");
                    const num = parseFloat(raw.replace(",", "."));
                    updateRow(row.n, { rate: isNaN(num) ? 0 : num });
                  }}
                  placeholder="0,00"
                  style={{
                    width: "52px", background: "transparent", border: "none",
                    borderBottom: `1px solid ${row.active ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)"}`,
                    color: row.active ? "#e4e4e7" : "#52525b", fontSize: "13px",
                    outline: "none", padding: "2px 0", textAlign: "right",
                    fontFamily: "inherit",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#52525b" }}>%</span>
              </div>

              {/* Preview */}
              <span style={{
                fontSize: "11px",
                fontWeight: row.active ? 600 : 400,
                color: row.active ? "#34d399" : "#3f3f46",
              }}>
                {row.active && row.rate > 0
                  ? calcPreview(previewValue, row.rate, row.n)
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Grade 13x–24x (Em breve) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "#3f3f46", letterSpacing: "0.07em" }}>13x – 24x — NOVA OPERADORA</p>
          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "5px", background: "rgba(251,191,36,0.08)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.15)" }}>
            Em breve
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px" }}>
          {future.map((row) => (
            <div
              key={row.n}
              style={{
                background: "rgba(255,255,255,0.01)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "12px",
                padding: "14px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                opacity: 0.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "18px", fontWeight: 700, color: "#3f3f46" }}>{row.n}x</span>
                <button
                  onClick={() => updateRow(row.n, { active: !row.active })}
                  style={{
                    width: "32px", height: "18px", borderRadius: "9px", border: "none",
                    background: row.active ? "#10b981" : "rgba(255,255,255,0.08)",
                    cursor: "pointer", position: "relative", transition: "background 200ms",
                  }}
                >
                  <span style={{
                    position: "absolute", top: "3px",
                    left: row.active ? "16px" : "3px",
                    width: "12px", height: "12px", borderRadius: "50%",
                    background: "#fff", transition: "left 200ms",
                  }} />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.rate === 0 ? "" : String(row.rate).replace(".", ",")}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9,]/g, "");
                    const num = parseFloat(raw.replace(",", "."));
                    updateRow(row.n, { rate: isNaN(num) ? 0 : num });
                  }}
                  placeholder="—"
                  style={{
                    width: "52px", background: "transparent", border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    color: "#52525b", fontSize: "13px",
                    outline: "none", padding: "2px 0", textAlign: "right",
                    fontFamily: "inherit",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#3f3f46" }}>%</span>
              </div>
              <span style={{ fontSize: "11px", color: "#3f3f46" }}>—</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status save */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#52525b" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: saving ? "#fbbf24" : saved ? "#10b981" : "#3f3f46", flexShrink: 0, display: "inline-block" }} />
        {saving ? "Salvando..." : saved ? "Configurações salvas" : "Alterações salvas automaticamente"}
      </div>
    </div>
  );
}

export function IASettingsClient({ clinic, versions, treatments, canEditPrices, serviceNoun }: { clinic: ClinicData; versions: Version[]; treatments: Treatment[]; canEditPrices: boolean; serviceNoun: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("geral");
  const [focusTarget, setFocusTarget] = useState<SettingsFocusTarget | null>(null);
  const handleFocusHandled = useCallback(() => setFocusTarget(null), []);

  const pills = [
    { icon: <Timer size={12} strokeWidth={1.8} />, label: `Pausa Automática (${clinic.takeoverTtlHours ?? 4}h)`, target: "takeover" as const },
    { icon: <CalendarClock size={12} strokeWidth={1.8} />, label: `Intervalo (${clinic.postAppointmentBufferMinutes ?? 60}min)`, target: "buffer" as const },
    { icon: <Clock size={12} strokeWidth={1.8} />, label: `Horário (${clinic.businessHours?.replace(/seg(unda)?/i, "").replace(/a\s+sex(ta)?/i, "").trim().slice(0, 12) ?? "—"})`, target: "hours" as const },
  ];

  const tabs: { id: Tab; label: string }[] = [
    { id: "geral", label: "Comportamento" },
    { id: "playbooks", label: "Playbooks" },
    { id: "procedimentos", label: "Procedimentos" },
    { id: "financeiro", label: "Financeiro" },
  ];

  return (
    <div className="ia-settings-shell">
      <style>{`
        .ia-settings-shell {
          width: 100%;
          max-width: 100vw;
          overflow-x: hidden;
          -webkit-text-size-adjust: 100%;
        }
        .ia-settings-shell *,
        .ia-settings-shell *::before,
        .ia-settings-shell *::after { box-sizing: border-box; }
        .ia-header { padding: 28px 32px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ia-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
        .ia-pills { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .ia-content { padding: 28px 32px; overflow-x: hidden; }
        .ia-versions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        .ia-geral-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .ia-playbooks-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
        .ia-settings-shell input,
        .ia-settings-shell textarea,
        .ia-settings-shell select {
          caret-color: #10b981;
          min-width: 0;
        }
        .ia-settings-shell input:focus,
        .ia-settings-shell textarea:focus,
        .ia-settings-shell select:focus {
          border-color: rgba(16,185,129,0.5) !important;
          box-shadow: 0 0 0 3px rgba(16,185,129,0.12) !important;
          outline: none !important;
        }
        @media (max-width: 820px) {
          .ia-settings-shell { padding: 0 !important; min-height: var(--vh, 100dvh); }
          .ia-header {
            padding:
              calc(env(safe-area-inset-top, 0px) + 20px)
              calc(env(safe-area-inset-right, 0px) + 16px)
              0
              calc(env(safe-area-inset-left, 0px) + 16px);
          }
          .ia-header-top { flex-direction: column; gap: 14px; margin-bottom: 16px; }
          .ia-pills { display: none; }
          .ia-content {
            padding:
              20px
              calc(env(safe-area-inset-right, 0px) + 16px)
              calc(env(safe-area-inset-bottom, 0px) + 20px)
              calc(env(safe-area-inset-left, 0px) + 16px);
          }
          .ia-versions-grid { grid-template-columns: 1fr; }
          .ia-geral-grid { grid-template-columns: 1fr; }
          .ia-status-card { padding: 14px !important; }
          .ia-status-row { flex-direction: column; align-items: stretch !important; }
          .ia-status-main { align-items: flex-start !important; }
          .ia-status-actions { width: 100%; justify-content: space-between; padding-left: 48px; }
          .ia-section-heading { align-items: flex-start !important; }
          .ia-choice-grid { grid-template-columns: 1fr !important; }
          .ia-number-row input { width: 96px !important; }
          .ia-settings-shell input,
          .ia-settings-shell textarea,
          .ia-settings-shell select {
            font-size: 16px !important;
            -webkit-text-size-adjust: 100%;
          }
          .ia-tabs { width: 100%; overflow-x: auto; scrollbar-width: none; }
          .ia-tabs::-webkit-scrollbar { display: none; }
          .menu-intent-label { display: none; }
          .ia-tab-btn { flex: 1 0 auto; text-align: center; justify-content: center; padding: 10px 8px !important; font-size: 13px !important; min-width: max-content; }
          .treatment-form { grid-template-columns: minmax(0, 1fr) auto !important; grid-template-rows: auto auto auto; padding: 14px !important; gap: 10px !important; align-items: center !important; }
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
          .ia-playbooks-toolbar { align-items: stretch; }
          .ia-playbooks-toolbar > button { width: 100%; justify-content: center; }
        }
      `}</style>

      {/* Header */}
      <div className="ia-header">
        <div className="ia-header-top">
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700, color: "#fafafa" }}>Configurações da IA</h1>
            <p style={{ margin: 0, fontSize: "13px", color: "#52525b" }}>
              Gerencie o comportamento e o conhecimento da sua inteligência artificial.
            </p>
          </div>
          <div className="ia-pills">
            {pills.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setTab("geral");
                  setFocusTarget(p.target);
                }}
                title="Editar em Comportamento"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  color: "#71717a",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "border-color 120ms, color 120ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(16,185,129,0.35)"; (e.currentTarget as HTMLButtonElement).style.color = "#a1a1aa"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLButtonElement).style.color = "#71717a"; }}
              >
                <span style={{ color: "#34d399" }}>{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="ia-tabs" style={{ display: "flex", gap: "0" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              className="ia-tab-btn"
              onClick={() => setTab(t.id)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: tab === t.id ? "2px solid #10b981" : "2px solid transparent",
                color: tab === t.id ? "#fafafa" : "#52525b",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: tab === t.id ? 600 : 400,
                padding: "10px 16px",
                transition: "all 150ms",
                marginBottom: "-1px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="ia-content">
        {tab === "geral" && (
          <GeralTab
            clinic={clinic}
            focusTarget={focusTarget}
            onFocusHandled={handleFocusHandled}
          />
        )}

        {tab === "playbooks" && (
          <div>
            <div className="ia-playbooks-toolbar">
              <p style={{ margin: 0, fontSize: "13px", color: "#52525b", lineHeight: 1.6 }}>
                Cada versão é um conjunto independente de regras para a IA. A versão em produção é a que está ativa.
              </p>
              <button
                onClick={() => router.push("/app/settings/playbook/simulate")}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.2)", borderRadius: "8px", color: "#00d4aa", fontSize: "13px", fontWeight: 600, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
              >
                <FlaskConical size={14} /> Testar IA
              </button>
            </div>
            <div className="ia-versions-grid">
              {versions.map((v, i) => (
                <VersionCard key={v.id} version={v} index={i} />
              ))}
              <NewVersionCard />
            </div>
          </div>
        )}

        {tab === "procedimentos" && <ProcedimentosTab treatments={treatments} canEditPrices={canEditPrices} serviceNoun={serviceNoun} />}
        {tab === "financeiro" && <FinanceiroTab clinic={clinic} />}
      </div>
    </div>
  );
}

// Shared styles
const cardStyle: React.CSSProperties = {
  background: "#0d0d0f",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "12px",
  padding: "16px 18px",
  display: "flex",
  alignItems: "flex-start",
  gap: "14px",
};

const iconBoxStyle: React.CSSProperties = {
  width: "34px",
  height: "34px",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(16,185,129,0.07)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const primaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "8px 16px",
  background: "#10b981",
  border: "none",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  justifyContent: "center",
};

const outlineBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: "#a1a1aa",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  flex: 1,
  justifyContent: "center",
};

const activeBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "rgba(16,185,129,0.12)",
  color: "#34d399",
  border: "1px solid rgba(16,185,129,0.25)",
  cursor: "default",
  flex: 1,
};

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  borderRadius: "7px",
  color: "#e4e4e7",
  fontSize: "13px",
  cursor: "pointer",
  textAlign: "left",
};

const geralInputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "8px",
  color: "#e4e4e7",
  fontSize: "16px",
  padding: "10px 14px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  lineHeight: 1.45,
};
