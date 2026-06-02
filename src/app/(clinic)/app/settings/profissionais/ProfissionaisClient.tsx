"use client";

import { useState, useRef } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

type Professional = {
  id: string;
  name: string;
  specialty: string | null;
  color: string;
  isActive: boolean;
};

type Props = {
  initialProfessionals: Professional[];
};

const COLOR_PRESETS = [
  { value: "#10b981", label: "Esmeralda" },
  { value: "#3b82f6", label: "Azul" },
  { value: "#f59e0b", label: "Âmbar" },
  { value: "#8b5cf6", label: "Violeta" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#06b6d4", label: "Ciano" },
  { value: "#f97316", label: "Laranja" },
  { value: "#ef4444", label: "Vermelho" },
];

function ColorSwatch({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (color: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {COLOR_PRESETS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          title={label}
          onClick={() => onChange(value)}
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: value,
            border: selected === value ? "2px solid var(--text)" : "2px solid transparent",
            outline: selected === value ? `2px solid ${value}` : "none",
            outlineOffset: "1px",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

function ProfessionalAvatar({ name, color }: { name: string; color: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      style={{
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        background: `${color}22`,
        border: `2px solid ${color}55`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        fontSize: "12px",
        fontWeight: 700,
        color,
        letterSpacing: "0.02em",
      }}
    >
      {initials || <UserRound size={14} strokeWidth={2} style={{ color }} />}
    </div>
  );
}

function ProfessionalRow({
  professional,
  onUpdated,
  onDeleted,
}: {
  professional: Professional;
  onUpdated: (updated: Professional) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState(professional.name);
  const [specialty, setSpecialty] = useState(professional.specialty ?? "");
  const [color, setColor] = useState(professional.color);
  const [isActive, setIsActive] = useState(professional.isActive);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/professionals/${professional.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), specialty: specialty.trim() || null, color, isActive }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated({ ...data.professional, id: professional.id });
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    const next = !isActive;
    setIsActive(next);
    await fetch(`/api/professionals/${professional.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    onUpdated({ ...professional, isActive: next });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/professionals/${professional.id}`, { method: "DELETE" });
      onDeleted(professional.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        borderBottom: "1px solid var(--line)",
        transition: "background 0.15s",
      }}
    >
      {/* Row header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "12px 20px",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <ProfessionalAvatar name={professional.name} color={color} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: isActive ? "var(--text)" : "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {professional.name}
            {!isActive && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: "var(--line)",
                  color: "var(--muted)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Inativo
              </span>
            )}
          </div>
          {professional.specialty && (
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "1px" }}>
              {professional.specialty}
            </div>
          )}
        </div>

        <ChevronRight
          size={15}
          strokeWidth={2}
          style={{
            color: "var(--muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        />
      </div>

      {/* Expanded edit panel */}
      {expanded && (
        <div
          style={{
            padding: "16px 20px 20px",
            borderTop: "1px solid var(--line)",
            background: "var(--surface-soft)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {/* Name + Specialty */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "5px" }}>
                Nome
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ margin: 0, fontSize: "13px" }}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "5px" }}>
                Especialidade
              </span>
              <input
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Ex: Ortodontia"
                style={{ margin: 0, fontSize: "13px" }}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          </div>

          {/* Color */}
          <div>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "8px" }}>
              Cor no calendário
            </span>
            <ColorSwatch selected={color} onChange={setColor} />
          </div>

          {/* Actions row */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "2px" }}>
            {/* Active toggle */}
            <button
              type="button"
              onClick={handleToggleActive}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 500,
                border: "1px solid var(--line)",
                borderRadius: "8px",
                background: "transparent",
                color: isActive ? "var(--accent-strong)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: isActive ? "var(--accent-strong)" : "var(--muted)",
                  flexShrink: 0,
                }}
              />
              {isActive ? "Ativo" : "Inativo"}
            </button>

            <div style={{ flex: 1 }} />

            {/* Delete */}
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  border: "1px solid var(--line)",
                  borderRadius: "8px",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <Trash2 size={12} strokeWidth={2} />
                Remover
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>Confirmar remoção?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    padding: "5px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    border: "none",
                    borderRadius: "7px",
                    background: "#ef444420",
                    color: "#ef4444",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {deleting ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : null}
                  Sim, remover
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: "5px 10px",
                    fontSize: "12px",
                    border: "1px solid var(--line)",
                    borderRadius: "7px",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Save */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="primary-button"
              style={{ padding: "6px 14px", fontSize: "13px", gap: "6px", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? (
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
              ) : savedOk ? (
                <CheckCircle2 size={12} />
              ) : null}
              {saving ? "Salvando..." : savedOk ? "Salvo" : "Salvar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddProfessionalForm({ onCreated }: { onCreated: (p: Professional) => void }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [color, setColor] = useState("#10b981");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/professionals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), specialty: specialty.trim() || undefined, color }),
      });
      if (res.ok) {
        const data = await res.json();
        onCreated(data.professional);
        setName("");
        setSpecialty("");
        setColor("#10b981");
        nameRef.current?.focus();
      } else {
        const data = await res.json();
        setError(data.error ?? "Erro ao criar profissional");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: "14px",
        background: "var(--surface-soft)",
        padding: "20px 22px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "40px",
            height: "40px",
            flexShrink: 0,
            borderRadius: "10px",
            border: "1px solid var(--line)",
            background: "var(--surface-raised)",
            color: "var(--accent-strong)",
          }}
        >
          <Plus size={18} strokeWidth={1.8} />
        </div>
        <div>
          <strong style={{ fontSize: "15px", fontWeight: 700, color: "var(--text)" }}>
            Adicionar profissional
          </strong>
          <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
            Cada profissional aparece com sua cor no calendário. Você pode filtrar por profissional na agenda.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <label style={{ margin: 0 }}>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "5px" }}>
              Nome *
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. João Silva"
              required
              style={{ margin: 0, fontSize: "13px" }}
            />
          </label>
          <label style={{ margin: 0 }}>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "5px" }}>
              Especialidade
            </span>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Ex: Implantodontia"
              style={{ margin: 0, fontSize: "13px" }}
            />
          </label>
        </div>

        <div>
          <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: "8px" }}>
            Cor no calendário
          </span>
          <ColorSwatch selected={color} onChange={setColor} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: `${color}22`,
              border: `2px solid ${color}66`,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "10px", fontWeight: 700, color }}>
              {name.split(" ")[0]?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <span style={{ fontSize: "12px", color: "var(--muted)", flex: 1 }}>
            {name.trim() || "Nome do profissional"}
          </span>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="primary-button"
            style={{ gap: "8px", opacity: saving || !name.trim() ? 0.6 : 1 }}
          >
            {saving ? (
              <Loader2 size={14} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Plus size={14} strokeWidth={2} />
            )}
            {saving ? "Adicionando..." : "Adicionar"}
          </button>
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: "13px", color: "#ef4444" }}>{error}</p>
        )}
      </form>
    </section>
  );
}

export function ProfissionaisClient({ initialProfessionals }: Props) {
  const [professionals, setProfessionals] = useState<Professional[]>(initialProfessionals);

  function handleUpdated(updated: Professional) {
    setProfessionals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function handleDeleted(id: string) {
    setProfessionals((prev) => prev.filter((p) => p.id !== id));
  }

  function handleCreated(newP: Professional) {
    setProfessionals((prev) => [...prev, newP]);
  }

  const active = professionals.filter((p) => p.isActive);
  const inactive = professionals.filter((p) => !p.isActive);

  return (
    <div style={{ maxWidth: "740px", margin: "0 auto", padding: "40px 24px 80px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <p className="eyebrow" style={{ marginBottom: "6px" }}>Configurações</p>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: "42px",
              height: "42px",
              borderRadius: "11px",
              border: "1px solid var(--line)",
              background: "var(--surface-raised)",
              color: "var(--accent-strong)",
              flexShrink: 0,
            }}
          >
            <Users size={20} strokeWidth={1.8} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "var(--text)" }}>
              Profissionais
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: "13px", color: "var(--muted)" }}>
              Gerencie a equipe que aparece no calendário da clínica.
            </p>
          </div>
        </div>
      </div>

      {/* List */}
      {professionals.length > 0 ? (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "14px",
            overflow: "hidden",
            marginBottom: "24px",
          }}
        >
          {/* Section: Active */}
          {active.length > 0 && (
            <div>
              {active.length < professionals.length && (
                <div
                  style={{
                    padding: "8px 20px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--muted)",
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--surface-soft)",
                  }}
                >
                  Ativos
                </div>
              )}
              {active.map((p) => (
                <ProfessionalRow
                  key={p.id}
                  professional={p}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )}

          {/* Section: Inactive */}
          {inactive.length > 0 && (
            <div>
              <div
                style={{
                  padding: "8px 20px",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--muted)",
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  borderTop: active.length > 0 ? "1px solid var(--line)" : undefined,
                  borderBottom: "1px solid var(--line)",
                  background: "var(--surface-soft)",
                }}
              >
                Inativos
              </div>
              {inactive.map((p) => (
                <ProfessionalRow
                  key={p.id}
                  professional={p}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "14px",
            padding: "40px 24px",
            textAlign: "center",
            marginBottom: "24px",
          }}
        >
          <Users size={28} strokeWidth={1.5} style={{ color: "var(--muted)", margin: "0 auto 12px" }} />
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
            Nenhum profissional cadastrado
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--muted)" }}>
            Adicione a equipe para filtrar a agenda por profissional.
          </p>
        </div>
      )}

      {/* Add form */}
      <AddProfessionalForm onCreated={handleCreated} />
    </div>
  );
}
