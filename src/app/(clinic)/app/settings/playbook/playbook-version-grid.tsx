"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus, Edit2, Copy, Trash2, Check, Pencil } from "lucide-react";
import {
  activatePlaybookVersion,
  renamePlaybookVersion,
  duplicatePlaybookVersion,
  deletePlaybookVersion,
  createPlaybookVersion,
} from "./playbook-version-actions";

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
  if (mins < 60) return `há ${mins} min`;
  if (hours < 24) return `há ${hours}h`;
  if (days < 30) return `há ${days} dias`;
  const d = new Date(date);
  return `em ${d.getDate().toString().padStart(2, "0")} ${d.toLocaleString("pt-BR", { month: "short" })}`;
}

function StatusBadge({ status }: { status: Version["status"] }) {
  const styles: Record<Version["status"], React.CSSProperties> = {
    active: {
      background: "rgba(16, 185, 129, 0.15)",
      color: "#34d399",
      border: "1px solid rgba(16, 185, 129, 0.3)",
    },
    draft: {
      background: "rgba(255,255,255,0.06)",
      color: "#a1a1aa",
      border: "1px solid rgba(255,255,255,0.1)",
    },
    historical: {
      background: "rgba(255,255,255,0.04)",
      color: "#71717a",
      border: "1px solid rgba(255,255,255,0.07)",
    },
  };

  const labels: Record<Version["status"], string> = {
    active: "ATIVO",
    draft: "RASCUNHO",
    historical: "HISTÓRICO",
  };

  return (
    <span
      style={{
        ...styles[status],
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "3px 10px",
        borderRadius: "6px",
        display: "inline-block",
      }}
    >
      {labels[status]}
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
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
      <button
        onClick={() => { onRename(); onClose(); }}
        style={menuItemStyle}
      >
        <Pencil size={14} /> Renomear
      </button>
      <button
        onClick={() => {
          startTransition(async () => {
            await duplicatePlaybookVersion(version.id);
            onClose();
          });
        }}
        disabled={isPending}
        style={menuItemStyle}
      >
        <Copy size={14} /> Duplicar
      </button>
      {version.status !== "active" && (
        <>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <button
            onClick={() => {
              startTransition(async () => {
                await deletePlaybookVersion(version.id);
                onClose();
              });
            }}
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

function VersionCard({ version }: { version: Version }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(version.name);
  const [isPending, startTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  function handleRenameSubmit() {
    if (!newName.trim() || newName === version.name) { setRenaming(false); return; }
    startTransition(async () => {
      await renamePlaybookVersion(version.id, newName.trim());
      setRenaming(false);
    });
  }

  return (
    <div
      style={{
        background: "#141416",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        padding: "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        minHeight: "200px",
        position: "relative",
        transition: "border-color 150ms",
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)")
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <StatusBadge status={version.status} />
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              background: "transparent",
              border: "none",
              color: "#71717a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <ContextMenu
              version={version}
              onClose={() => setMenuOpen(false)}
              onRename={() => setRenaming(true)}
            />
          )}
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
            style={{
              background: "transparent",
              border: "none",
              borderBottom: "1px solid rgba(16,185,129,0.5)",
              color: "#fafafa",
              fontSize: "17px",
              fontWeight: 700,
              width: "100%",
              outline: "none",
              padding: "2px 0",
            }}
          />
        ) : (
          <h3
            style={{
              margin: 0,
              fontSize: "17px",
              fontWeight: 700,
              color: "#fafafa",
              lineHeight: 1.3,
            }}
          >
            {version.name}
          </h3>
        )}
        <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#52525b" }}>
          Editado {timeAgo(version.updatedAt)}
        </p>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => router.push(`/app/settings/playbook/${version.id}`)}
          style={outlineButtonStyle}
        >
          <Edit2 size={13} /> Editar
        </button>
        {version.status === "active" ? (
          <button style={activeButtonStyle} disabled>
            <Check size={13} strokeWidth={2.5} /> Em produção
          </button>
        ) : (
          <button
            onClick={() =>
              startTransition(async () => {
                await activatePlaybookVersion(version.id);
              })
            }
            disabled={isPending}
            style={primaryButtonStyle}
          >
            Ativar
          </button>
        )}
      </div>
    </div>
  );
}

const outlineButtonStyle: React.CSSProperties = {
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

const primaryButtonStyle: React.CSSProperties = {
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
  flex: 1,
  justifyContent: "center",
};

const activeButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "rgba(16, 185, 129, 0.12)",
  color: "#34d399",
  border: "1px solid rgba(16, 185, 129, 0.25)",
  cursor: "default",
};

function NewVersionCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  function handleSubmit() {
    if (!name.trim()) { setCreating(false); return; }
    onCreate(name.trim());
    setName("");
    setCreating(false);
  }

  return (
    <div
      onClick={() => !creating && setCreating(true)}
      style={{
        background: "transparent",
        border: "1px dashed rgba(255,255,255,0.1)",
        borderRadius: "14px",
        padding: "22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        minHeight: "200px",
        cursor: creating ? "default" : "pointer",
        transition: "border-color 150ms",
      }}
      onMouseEnter={(e) =>
        !creating &&
        ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.2)")
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.1)")
      }
    >
      {creating ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do playbook..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") { setCreating(false); setName(""); }
            }}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: "8px",
              color: "#fafafa",
              fontSize: "14px",
              padding: "10px 12px",
              width: "100%",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleSubmit}
              style={{ ...primaryButtonStyle, flex: 1 }}
            >
              Criar
            </button>
            <button
              onClick={() => { setCreating(false); setName(""); }}
              style={{ ...outlineButtonStyle, flex: "none", padding: "8px 12px" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#52525b",
            }}
          >
            <Plus size={20} />
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: "#52525b" }}>Criar nova versão</p>
        </>
      )}
    </div>
  );
}

export function PlaybookVersionGrid({ versions }: { versions: Version[] }) {
  const [, startTransition] = useTransition();

  function handleCreate(name: string) {
    startTransition(async () => {
      await createPlaybookVersion(name);
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "16px",
      }}
    >
      {versions.map((v) => (
        <VersionCard key={v.id} version={v} />
      ))}
      <NewVersionCard onCreate={handleCreate} />
    </div>
  );
}
