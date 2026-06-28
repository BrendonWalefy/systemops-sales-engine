"use client";

import { useEffect, useState } from "react";
import { X, Lightbulb, AlertCircle, TrendingDown, HelpCircle, Calendar, Package, Bot, Wrench } from "lucide-react";
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

function InsightRow({
  insight,
  dismissing,
  onDismiss,
}: {
  insight: OperationalInsight;
  dismissing: Set<string>;
  onDismiss: (key: string) => void;
}) {
  const Icon = TYPE_ICONS[insight.type] ?? Lightbulb;
  const isDismissing = dismissing.has(insight.key);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        background: "var(--surface)",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        opacity: isDismissing ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      <Icon size={14} color="var(--accent-strong)" style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
          {insight.title}
          {insight.affectedCount >= 1 && (
            <a
              href="/app/inbox"
              style={{
                marginLeft: 6,
                fontWeight: 400,
                color: "var(--muted)",
                fontSize: 11,
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: 2,
                cursor: "pointer",
              }}
              title="Ver conversas no inbox"
            >
              · {insight.affectedCount} {insight.affectedCount === 1 ? "conversa" : "conversas"}
            </a>
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
