"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Timer, CalendarClock, Clock, MoreHorizontal, Plus, Edit2, Copy, Trash2, Check, Pencil, Zap } from "lucide-react";
import {
  activatePlaybookVersion,
  renamePlaybookVersion,
  duplicatePlaybookVersion,
  deletePlaybookVersion,
  createPlaybookVersion,
} from "./playbook-version-actions";
import { toggleAutoReply } from "./actions";

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
};

type Tab = "geral" | "playbooks" | "procedimentos";

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
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "8px", color: "#fafafa", fontSize: "14px", padding: "10px 12px", width: "100%", outline: "none", boxSizing: "border-box" }}
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

function GeralTab({ clinic, iaVersionsGridClass }: { clinic: ClinicData; iaVersionsGridClass?: string }) {
  const [enabled, setEnabled] = useState(clinic.autoReplyEnabled ?? false);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => { await toggleAutoReply(!next); });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "640px" }}>
      {/* Status IA */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={iconBoxStyle}>
              <Zap size={16} strokeWidth={1.8} style={{ color: "#34d399" }} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Status da IA</strong>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "5px",
                    ...(enabled
                      ? { background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }
                      : { background: "rgba(255,255,255,0.05)", color: "#71717a", border: "1px solid rgba(255,255,255,0.08)" }),
                  }}
                >
                  {enabled ? "Active" : "Pausada"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#52525b" }}>Recepcionista responde automaticamente via WhatsApp</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {enabled && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
                <span style={{ fontSize: "12px", color: "#34d399", fontWeight: 500 }}>IA Online</span>
              </div>
            )}
            <button
              onClick={handleToggle}
              disabled={isPending}
              style={{
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                background: enabled ? "#10b981" : "rgba(255,255,255,0.1)",
                cursor: isPending ? "default" : "pointer",
                position: "relative",
                transition: "background 200ms",
                flexShrink: 0,
                opacity: isPending ? 0.7 : 1,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: enabled ? "23px" : "3px",
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 200ms",
                }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Quick settings read-only info */}
      <div className={iaVersionsGridClass ?? "ia-geral-grid"} style={{ display: "grid", gap: "10px" }}>
        <InfoCard icon={<Timer size={14} strokeWidth={1.8} style={{ color: "#34d399" }} />} label="Pausa Automática" value={`${clinic.takeoverTtlHours ?? 4}h`} />
        <InfoCard icon={<CalendarClock size={14} strokeWidth={1.8} style={{ color: "#34d399" }} />} label="Intervalo" value={`${clinic.postAppointmentBufferMinutes ?? 60}min`} />
        <InfoCard icon={<Clock size={14} strokeWidth={1.8} style={{ color: "#34d399" }} />} label="Horário" value={clinic.businessHours ? clinic.businessHours.slice(0, 18) : "—"} />
      </div>

      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#3f3f46" }}>
        Para editar horários e comportamento da IA, acesse o editor de cada playbook.
      </p>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ ...cardStyle, flexDirection: "column", gap: "8px", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {icon}
        <span style={{ fontSize: "11px", color: "#52525b" }}>{label}</span>
      </div>
      <span style={{ fontSize: "14px", fontWeight: 600, color: "#e4e4e7" }}>{value}</span>
    </div>
  );
}

function ProcedimentosTab() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: "520px" }}>
      <div style={cardStyle}>
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 600, color: "#fafafa" }}>Gestão de Procedimentos</h3>
          <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#52525b" }}>
            Cadastre os procedimentos oferecidos pela clínica com duração e descrição. A IA usa essas informações para agendamento e respostas.
          </p>
          <button
            onClick={() => router.push("/app/settings/tratamentos")}
            style={{ ...primaryBtnStyle, width: "fit-content" }}
          >
            Gerenciar Procedimentos
          </button>
        </div>
      </div>
    </div>
  );
}

export function IASettingsClient({ clinic, versions }: { clinic: ClinicData; versions: Version[] }) {
  const [tab, setTab] = useState<Tab>("playbooks");

  const pills = [
    { icon: <Timer size={12} strokeWidth={1.8} />, label: `Pausa Automática (${clinic.takeoverTtlHours ?? 4}h)` },
    { icon: <CalendarClock size={12} strokeWidth={1.8} />, label: `Intervalo (${clinic.postAppointmentBufferMinutes ?? 60}min)` },
    { icon: <Clock size={12} strokeWidth={1.8} />, label: `Horário (${clinic.businessHours?.replace(/seg(unda)?/i, "").replace(/a\s+sex(ta)?/i, "").trim().slice(0, 12) ?? "—"})` },
  ];

  const tabs: { id: Tab; label: string }[] = [
    { id: "geral", label: "Geral" },
    { id: "playbooks", label: "Playbooks" },
    { id: "procedimentos", label: "Procedimentos" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <style>{`
        .ia-header { padding: 28px 32px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ia-header-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
        .ia-pills { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .ia-content { padding: 28px 32px; }
        .ia-versions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        .ia-geral-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        @media (max-width: 640px) {
          .ia-header { padding: 20px 16px 0; }
          .ia-header-top { flex-direction: column; gap: 14px; margin-bottom: 16px; }
          .ia-pills { display: none; }
          .ia-content { padding: 20px 16px; }
          .ia-versions-grid { grid-template-columns: 1fr; }
          .ia-geral-grid { grid-template-columns: 1fr; }
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
              <div
                key={i}
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
                }}
              >
                <span style={{ color: "#34d399" }}>{p.icon}</span>
                {p.label}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0", overflowX: "auto" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
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
        {tab === "geral" && <GeralTab clinic={clinic} iaVersionsGridClass="ia-geral-grid" />}

        {tab === "playbooks" && (
          <div>
            <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#52525b", lineHeight: 1.6 }}>
              Cada versão é um conjunto independente de regras para a IA. A versão em produção é a que está ativa.
            </p>
            <div className="ia-versions-grid">
              {versions.map((v, i) => (
                <VersionCard key={v.id} version={v} index={i} />
              ))}
              <NewVersionCard />
            </div>
          </div>
        )}

        {tab === "procedimentos" && <ProcedimentosTab />}
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
