"use client";

import { useEffect, useState } from "react";
import {
  X,
  Lightbulb,
  AlertCircle,
  TrendingDown,
  HelpCircle,
  Calendar,
  Package,
  Bot,
  Wrench,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import type { OperationalInsight } from "@/app/api/clinic/operational-insights/route";

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  price_objection: TrendingDown,
  price_not_set: TrendingDown,
  price_objection_unresolved: TrendingDown,
  hesitation_drop: AlertCircle,
  hesitation_after_reply: AlertCircle,
  unclear_response: HelpCircle,
  unnatural_reply: HelpCircle,
  service_gap: Package,
  missing_treatment: Package,
  info_gap: Package,
  scheduling_friction: Calendar,
  missed_opportunity: AlertCircle,
  wrong_info: AlertCircle,
  other: Lightbulb,
};

const AI_QUALITY_TYPES = new Set([
  "unclear_response",
  "missed_opportunity",
  "unnatural_reply",
  "price_objection_unresolved",
  "hesitation_after_reply",
]);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copiar instrução"
      style={{
        background: "none",
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        borderRadius: 6,
        cursor: "pointer",
        color: copied ? "var(--accent-strong)" : "var(--muted)",
        padding: "3px 8px",
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function InsightRow({
  insight,
  dismissing,
  onDismiss,
}: {
  insight: OperationalInsight;
  dismissing: Set<string>;
  onDismiss: (key: string) => void;
}) {
  const [showConvs, setShowConvs] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);

  const Icon = TYPE_ICONS[insight.type] ?? Lightbulb;
  const isDismissing = dismissing.has(insight.key);
  const convIds = insight.convIds ?? [];
  const actionData = insight.actionData ?? {};
  const suggestedInstruction = typeof actionData.suggestedInstruction === "string" ? actionData.suggestedInstruction : null;
  const treatmentId = typeof actionData.treatmentId === "string" ? actionData.treatmentId : null;
  const treatmentName = typeof actionData.treatmentName === "string" ? actionData.treatmentName : null;

  const showSuggestionButton = AI_QUALITY_TYPES.has(insight.type) && suggestedInstruction;
  const actionHref =
    insight.type === "missing_treatment"
      ? "/app/settings/pipeline"
      : insight.type === "price_not_set"
        ? treatmentId
          ? `/app/settings/pipeline/${treatmentId}`
          : "/app/settings/pipeline"
        : null;
  const actionLabel =
    insight.type === "missing_treatment"
      ? `Cadastrar${treatmentName ? ` "${treatmentName}"` : ""}`
      : insight.type === "price_not_set"
        ? "Definir preço"
        : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        background: "var(--surface)",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        opacity: isDismissing ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Icon size={14} color="var(--accent-strong)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
            {insight.title}
            {convIds.length > 0 && (
              <button
                onClick={() => setShowConvs((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  marginLeft: 6,
                  fontWeight: 400,
                  color: "var(--accent-strong)",
                  fontSize: 11,
                  padding: 0,
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  textUnderlineOffset: 2,
                }}
              >
                · {convIds.length} {convIds.length === 1 ? "conversa" : "conversas"}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
            {insight.description}
          </div>
        </div>
        <button
          onClick={() => onDismiss(insight.key)}
          disabled={isDismissing}
          title="Dispensar"
          style={{
            background: "none",
            border: "none",
            cursor: isDismissing ? "default" : "pointer",
            color: "var(--muted)",
            padding: 2,
            display: "flex",
            flexShrink: 0,
            opacity: isDismissing ? 0.3 : 0.6,
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Conversations expansion */}
      {showConvs && convIds.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingLeft: 24,
          }}
        >
          {convIds.map((id, i) => (
            <a
              key={id}
              href={`/app/inbox/${id}`}
              style={{
                fontSize: 11,
                color: "var(--accent-strong)",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <ExternalLink size={10} />
              Conversa {i + 1}
            </a>
          ))}
        </div>
      )}

      {/* Action row */}
      {(actionHref || showSuggestionButton) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
          {actionHref && actionLabel && (
            <a
              href={actionHref}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent-strong)",
                textDecoration: "none",
                border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                borderRadius: 6,
                padding: "3px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "color-mix(in srgb, var(--accent) 6%, transparent)",
              }}
            >
              {actionLabel}
            </a>
          )}
          {showSuggestionButton && (
            <button
              onClick={() => setShowSuggestion((v) => !v)}
              style={{
                background: "none",
                border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--muted)",
                padding: "3px 8px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
              }}
            >
              {showSuggestion ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showSuggestion ? "Fechar sugestão" : "Ver sugestão"}
            </button>
          )}
        </div>
      )}

      {/* Suggestion expansion */}
      {showSuggestion && suggestedInstruction && (
        <div
          style={{
            marginLeft: 24,
            padding: "8px 10px",
            background: "color-mix(in srgb, var(--accent) 4%, var(--surface))",
            border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.5,
              margin: 0,
              fontStyle: "italic",
            }}
          >
            {suggestedInstruction}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CopyButton text={suggestedInstruction} />
            <a
              href="/app/settings/playbook"
              style={{
                fontSize: 11,
                color: "var(--muted)",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: 2,
              }}
            >
              Abrir playbook
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function OperationalInsightsCard() {
  const [insights, setInsights] = useState<OperationalInsight[]>([]);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/clinic/operational-insights")
      .then((r) => r.json())
      .then((d: { insights?: OperationalInsight[] }) => {
        if (d.insights?.length) setInsights(d.insights);
      })
      .catch(() => {});
  }, []);

  async function dismiss(key: string) {
    setDismissing((prev) => new Set([...prev, key]));
    try {
      await fetch("/api/clinic/operational-insights", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      setInsights((prev) => prev.filter((i) => i.key !== key));
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const operational = insights.filter((i) => i.category === "operational");
  const aiQuality = insights.filter((i) => i.category === "ai_quality");

  if (!insights.length) return null;

  return (
    <div style={{ margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {aiQuality.length > 0 && (
        <div
          style={{
            background: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
            border: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <Bot size={13} color="var(--accent-strong)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-strong)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Insights da IA
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
              {aiQuality.length} {aiQuality.length === 1 ? "ponto" : "pontos"}
            </span>
          </div>
          {aiQuality.map((insight) => (
            <InsightRow key={insight.key} insight={insight} dismissing={dismissing} onDismiss={dismiss} />
          ))}
        </div>
      )}

      {operational.length > 0 && (
        <div
          style={{
            background: "color-mix(in srgb, var(--warning, #d97706) 6%, var(--surface))",
            border: "1px solid color-mix(in srgb, var(--warning, #d97706) 20%, transparent)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <Wrench size={13} color="var(--warning-strong, #b45309)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--warning-strong, #b45309)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Pontos de Melhoria
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
              {operational.length} {operational.length === 1 ? "ponto" : "pontos"}
            </span>
          </div>
          {operational.map((insight) => (
            <InsightRow key={insight.key} insight={insight} dismissing={dismissing} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </div>
  );
}
