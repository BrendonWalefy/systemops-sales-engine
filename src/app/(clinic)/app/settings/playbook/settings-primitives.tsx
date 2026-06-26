"use client";
import React, { useState, forwardRef } from "react";
import { ChevronDown } from "lucide-react";

// ─── Design tokens ─────────────────────────────────────────────────────────
export const S = {
  bg: "#071115",
  card: "rgba(255,255,255,0.04)",
  cardActive: "rgba(0,224,178,0.08)",
  border: "rgba(255,255,255,0.08)",
  borderActive: "rgba(0,224,178,0.4)",
  teal: "#00E0B2",
  tealDark: "#00A889",
  text: "#E6F2EE",
  textSec: "#9AA7A1",
  textMuted: "#66736F",
  amber: "#F5A524",
  error: "#EF4444",
  cardRadius: "14px",
  inputRadius: "10px",
  cardPad: "18px",
  inputH: "42px",
  btnH: "40px",
  textareaH: "96px",
  sectionGap: "16px",
  fs: { pg: "24px", title: "15px", desc: "12px", label: "11px", input: "14px" },
} as const;

// ─── Card ───────────────────────────────────────────────────────────────────
export function SettingsCard({
  children,
  active = false,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: active ? S.cardActive : S.card,
        border: `1px solid ${active ? S.borderActive : S.border}`,
        borderRadius: S.cardRadius,
        padding: S.cardPad,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Section heading ────────────────────────────────────────────────────────
export function SettingsSection({
  title,
  description,
  action,
  children,
  style,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", ...style }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <p style={{ margin: 0, fontSize: S.fs.label, fontWeight: 600, color: S.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</p>
          {description && (
            <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>{description}</p>
          )}
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── Row within card ────────────────────────────────────────────────────────
export function SettingsRow({
  label,
  description,
  children,
  last = false,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        paddingTop: "12px",
        paddingBottom: "12px",
        borderBottom: last ? "none" : `1px solid ${S.border}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 500, color: S.text }}>{label}</p>
        {description && (
          <p style={{ margin: "2px 0 0", fontSize: S.fs.desc, color: S.textSec }}>{description}</p>
        )}
      </div>
      {children && <div style={{ flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

// ─── Label uppercase ────────────────────────────────────────────────────────
export function SLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p
      style={{
        margin: "0 0 6px",
        fontSize: S.fs.label,
        fontWeight: 600,
        color: S.textMuted,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        ...style,
      }}
    >
      {children}
    </p>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────
export const inputStyle: React.CSSProperties = {
  width: "100%",
  height: S.inputH,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${S.border}`,
  borderRadius: S.inputRadius,
  color: S.text,
  fontSize: S.fs.input,
  padding: "0 14px",
  outline: "none",
  fontFamily: "inherit",
};

export const SettingsInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function SettingsInput(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        style={{ ...inputStyle, ...props.style }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = S.borderActive;
          e.currentTarget.style.boxShadow = `0 0 0 3px rgba(0,224,178,0.1)`;
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = S.border;
          e.currentTarget.style.boxShadow = "none";
          props.onBlur?.(e);
        }}
      />
    );
  },
);

// ─── Textarea ───────────────────────────────────────────────────────────────
export function SettingsTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: "100%",
        minHeight: S.textareaH,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${S.border}`,
        borderRadius: S.inputRadius,
        color: S.text,
        fontSize: S.fs.input,
        padding: "10px 14px",
        outline: "none",
        fontFamily: "inherit",
        resize: "vertical",
        lineHeight: 1.5,
        ...props.style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = S.borderActive;
        e.currentTarget.style.boxShadow = `0 0 0 3px rgba(0,224,178,0.1)`;
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = S.border;
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
    />
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────────────
export function SettingsToggle({
  checked,
  onChange,
  disabled = false,
  pending = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled || pending}
      aria-checked={checked}
      role="switch"
      style={{
        width: "40px",
        height: "22px",
        borderRadius: "11px",
        border: "none",
        background: checked ? S.teal : "rgba(255,255,255,0.12)",
        cursor: disabled || pending ? "default" : "pointer",
        position: "relative",
        transition: "background 200ms",
        flexShrink: 0,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "3px",
          left: checked ? "21px" : "3px",
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: "#fff",
          transition: "left 200ms",
        }}
      />
    </button>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────
type BadgeVariant = "active" | "pending" | "locked" | "recommended" | "draft" | "coming";

const badgeStyles: Record<BadgeVariant, React.CSSProperties> = {
  active: { background: "rgba(0,224,178,0.1)", color: S.teal, border: `1px solid rgba(0,224,178,0.25)` },
  recommended: { background: "rgba(0,224,178,0.07)", color: S.tealDark, border: `1px solid rgba(0,224,178,0.18)` },
  pending: { background: "rgba(245,165,36,0.1)", color: S.amber, border: `1px solid rgba(245,165,36,0.25)` },
  locked: { background: "rgba(255,255,255,0.05)", color: S.textMuted, border: `1px solid ${S.border}` },
  draft: { background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" },
  coming: { background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" },
};

export function SettingsBadge({ variant, children }: { variant: BadgeVariant; children: React.ReactNode }) {
  return (
    <span
      style={{
        ...badgeStyles[variant],
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: "6px",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ─── Collapsible advanced section ───────────────────────────────────────────
export function CollapsibleAdvanced({
  label = "Configurações avançadas",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: "12px" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: S.textMuted,
          fontSize: "12px",
          fontWeight: 600,
          padding: 0,
          letterSpacing: "0.03em",
        }}
      >
        <ChevronDown
          size={14}
          style={{ transition: "transform 200ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
        {label}
      </button>
      {open && <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>{children}</div>}
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "28px 20px",
        gap: "10px",
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          border: `1px solid ${S.border}`,
          background: S.card,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: S.textMuted,
        }}
      >
        {icon}
      </div>
      <div>
        <p style={{ margin: 0, fontSize: S.fs.title, fontWeight: 600, color: S.text }}>{title}</p>
        <p style={{ margin: "4px 0 0", fontSize: S.fs.desc, color: S.textSec, maxWidth: "280px" }}>{description}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: "4px",
            padding: "8px 16px",
            background: S.cardActive,
            border: `1px solid ${S.borderActive}`,
            borderRadius: "8px",
            color: S.teal,
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─── Save status indicator ───────────────────────────────────────────────────
export function SaveStatus({ saving, saved }: { saving: boolean; saved: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: S.textMuted }}>
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: saving ? S.amber : saved ? S.teal : S.textMuted,
          flexShrink: 0,
          display: "inline-block",
          transition: "background 300ms",
        }}
      />
      {saving ? "Salvando..." : saved ? "Configurações salvas" : "Alterações salvas automaticamente"}
    </div>
  );
}

// ─── Icon box ───────────────────────────────────────────────────────────────
export function IconBox({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div
      style={{
        width: "34px",
        height: "34px",
        borderRadius: "8px",
        border: `1px solid ${active ? "rgba(0,224,178,0.15)" : S.border}`,
        background: active ? "rgba(0,224,178,0.08)" : S.card,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: active ? S.teal : S.textMuted,
      }}
    >
      {children}
    </div>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────
export const primaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  height: S.btnH,
  padding: "0 16px",
  background: S.teal,
  border: "none",
  borderRadius: "10px",
  color: "#071115",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

export const outlineBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  height: S.btnH,
  padding: "0 14px",
  background: "transparent",
  border: `1px solid ${S.border}`,
  borderRadius: "10px",
  color: S.textSec,
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
};

export const activeBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: S.cardActive,
  color: S.teal,
  border: `1px solid ${S.borderActive}`,
  cursor: "default",
};
