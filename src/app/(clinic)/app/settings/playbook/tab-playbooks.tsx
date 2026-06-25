"use client";
import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Edit2, Check, Copy, Trash2, Pencil, MoreHorizontal, Workflow, Zap, Users, RefreshCw, Calendar, DollarSign, MessageSquare, ChevronRight } from "lucide-react";
import {
  activatePlaybookVersion,
  renamePlaybookVersion,
  duplicatePlaybookVersion,
  deletePlaybookVersion,
  createPlaybookVersion,
} from "./playbook-version-actions";
import { S, SettingsBadge, primaryBtnStyle, outlineBtnStyle, activeBtnStyle, EmptyState } from "./settings-primitives";

type Version = {
  id: string;
  name: string;
  status: "active" | "draft" | "historical";
  updatedAt: Date;
};

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

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "10px", width: "100%",
  padding: "8px 12px", background: "transparent", border: "none",
  borderRadius: "7px", color: S.text, fontSize: "13px", cursor: "pointer", textAlign: "left",
};

function ContextMenu({ version, onClose, onRename }: { version: Version; onClose: () => void; onRename: () => void }) {
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
    <div ref={menuRef} style={{
      position: "absolute", top: "36px", right: "8px", zIndex: 50,
      background: "#111820", border: `1px solid ${S.border}`,
      borderRadius: "10px", padding: "4px", minWidth: "160px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      <button onClick={() => { onRename(); onClose(); }} style={menuItemStyle}><Pencil size={13} /> Renomear</button>
      <button onClick={() => startTransition(async () => { await duplicatePlaybookVersion(version.id); onClose(); })} disabled={isPending} style={menuItemStyle}><Copy size={13} /> Duplicar</button>
      {version.status !== "active" && (
        <>
          <div style={{ height: "1px", background: S.border, margin: "4px 0" }} />
          <button onClick={() => startTransition(async () => { await deletePlaybookVersion(version.id); onClose(); })} disabled={isPending} style={{ ...menuItemStyle, color: "#f87171" }}><Trash2 size={13} /> Excluir</button>
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

  const statusVariant = version.status === "active" ? "active" : version.status === "draft" ? "draft" : "locked";
  const statusLabel = version.status === "active" ? "Em Produção" : version.status === "draft" ? "Draft" : "Histórico";

  return (
    <div style={{
      background: S.card, border: `1px solid ${S.border}`, borderRadius: "14px",
      padding: "18px", display: "flex", flexDirection: "column", gap: "10px",
      minHeight: "170px", position: "relative", transition: "border-color 150ms",
    }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = S.border)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: S.textMuted }}>{index + 1}</span>
          <SettingsBadge variant={statusVariant}>{statusLabel}</SettingsBadge>
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((o) => !o)} style={{ background: "transparent", border: "none", color: S.textMuted, cursor: "pointer", padding: "4px", borderRadius: "6px", display: "flex", alignItems: "center" }}>
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && <ContextMenu version={version} onClose={() => setMenuOpen(false)} onRename={() => setRenaming(true)} />}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {renaming ? (
          <input ref={renameRef} value={newName} onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); if (e.key === "Escape") setRenaming(false); }}
            style={{ background: "transparent", border: "none", borderBottom: `1px solid rgba(0,224,178,0.5)`, color: S.text, fontSize: "15px", fontWeight: 700, width: "100%", outline: "none", padding: "2px 0" }}
          />
        ) : (
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: S.text, lineHeight: 1.3 }}>{version.name}</h3>
        )}
        <p style={{ margin: "4px 0 0", fontSize: "11px", color: S.textMuted }}>Editado {timeAgo(version.updatedAt)}</p>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => router.push(`/app/settings/playbook/${version.id}`)} style={{ ...outlineBtnStyle, height: "34px", flex: 1 }}>
          <Edit2 size={12} />
          {version.status === "active" ? "Editar Contexto" : "Editar"}
        </button>
        {version.status === "active" ? (
          <button style={{ ...activeBtnStyle, height: "34px", flex: 1 }} disabled>
            <Check size={12} strokeWidth={2.5} /> Em produção
          </button>
        ) : (
          <button onClick={() => startTransition(async () => { await activatePlaybookVersion(version.id); })} disabled={isPending} style={{ ...primaryBtnStyle, height: "34px", flex: 1 }}>
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
    <div onClick={() => !creating && !isPending && setCreating(true)} style={{
      background: "transparent", border: `1px dashed ${S.border}`,
      borderRadius: "14px", padding: "18px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: "8px", minHeight: "170px",
      cursor: creating || isPending ? "default" : "pointer", transition: "border-color 150ms",
    }}
      onMouseEnter={(e) => !creating && ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.18)")}
      onMouseLeave={(e) => !creating && ((e.currentTarget as HTMLDivElement).style.borderColor = S.border)}
    >
      {creating ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
          <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Nome do playbook..."
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { setCreating(false); setName(""); } }}
            style={{ background: S.card, border: `1px solid rgba(0,224,178,0.4)`, borderRadius: "8px", color: S.text, fontSize: "15px", padding: "10px 12px", width: "100%", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSubmit} disabled={isPending} style={{ ...primaryBtnStyle, flex: 1 }}>Criar</button>
            <button onClick={() => { setCreating(false); setName(""); }} style={{ ...outlineBtnStyle, flex: "none", padding: "0 12px" }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: S.textMuted }}>
            <Plus size={16} />
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: S.textMuted }}>Criar nova versão</p>
        </>
      )}
    </div>
  );
}

const TEMPLATE_PLAYBOOKS = [
  { icon: <Zap size={14} />, label: "Novo lead", desc: "Primeiro contato — qualificar e engajar" },
  { icon: <MessageSquare size={14} />, label: "Lead frio", desc: "Reengajar leads inativos há mais de 7 dias" },
  { icon: <Users size={14} />, label: "Lead quente", desc: "Lead demonstrou interesse direto — fechar consulta" },
  { icon: <RefreshCw size={14} />, label: "Recuperação", desc: "Conversa parada há mais de 24h" },
  { icon: <Calendar size={14} />, label: "Confirmação de agenda", desc: "D-1: confirmar presença" },
  { icon: <DollarSign size={14} />, label: "Pedido de preço", desc: "Lead perguntou sobre valores" },
];

export function TabPlaybooks({ versions }: { versions: Version[] }) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "800px" }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: "0 0 2px", fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Versões de playbook</p>
          <p style={{ margin: 0, fontSize: S.fs.desc, color: S.textSec }}>
            Cada versão é um conjunto independente de regras. A versão em produção é a que está ativa.
          </p>
        </div>
        <button
          onClick={() => router.push("/app/settings/playbook/simulate")}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "rgba(0,224,178,0.08)", border: `1px solid rgba(0,224,178,0.2)`, borderRadius: "8px", color: S.teal, fontSize: "13px", fontWeight: 600, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
        >
          <FlaskConical size={13} /> Testar IA
        </button>
      </div>

      {/* Version grid */}
      <div className="ia-versions-grid">
        {versions.map((v, i) => <VersionCard key={v.id} version={v} index={i} />)}
        <NewVersionCard />
      </div>

      {/* Template playbooks — scaffolding */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <Workflow size={14} style={{ color: S.textMuted }} />
          <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 600, color: S.text }}>Fluxos estratégicos</p>
          <SettingsBadge variant="coming">Em breve</SettingsBadge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
          {TEMPLATE_PLAYBOOKS.map((tpl) => (
            <div key={tpl.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
              background: S.card, border: `1px solid ${S.border}`,
              borderRadius: "10px", padding: "12px 14px", opacity: 0.5,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <span style={{ color: S.textMuted, flexShrink: 0 }}>{tpl.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: S.text }}>{tpl.label}</p>
                  <p style={{ margin: "1px 0 0", fontSize: "11px", color: S.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.desc}</p>
                </div>
              </div>
              <ChevronRight size={13} style={{ color: S.textMuted, flexShrink: 0 }} />
            </div>
          ))}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: "11px", color: S.textMuted }}>
          Templates pré-configurados para cada etapa do funil. Configure uma vez, a IA aplica automaticamente.
        </p>
      </div>
    </div>
  );
}
