"use client";

import { useEffect, useState } from "react";
import { X, Lightbulb } from "lucide-react";

type GapRow = { mentionedText: string; count: number };

export function TreatmentGapBanner() {
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/clinic/treatment-gaps")
      .then((r) => r.json())
      .then((d: { gaps?: GapRow[] }) => {
        if (d.gaps?.length) setGaps(d.gaps);
      })
      .catch(() => {});
  }, []);

  async function dismiss(mentionedText: string) {
    setDismissing((prev) => new Set([...prev, mentionedText]));
    try {
      await fetch("/api/clinic/treatment-gaps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentionedText }),
      });
      setGaps((prev) => prev.filter((g) => g.mentionedText !== mentionedText));
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(mentionedText);
        return next;
      });
    }
  }

  if (!gaps.length) return null;

  return (
    <div style={{ padding: "0 28px 0", marginBottom: 4 }}>
      <div
        style={{
          background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)",
          borderRadius: 10,
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
          <Lightbulb size={13} color="var(--accent-strong)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-strong)" }}>
            Oportunidades de catálogo
          </span>
        </div>
        {gaps.map((gap) => (
          <div
            key={gap.mentionedText}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text)",
            }}
          >
            <span style={{ flex: 1 }}>
              <strong>{gap.count}</strong>{" "}
              {gap.count === 1 ? "lead mencionou" : "leads mencionaram"}{" "}
              <em style={{ color: "var(--accent-strong)" }}>&ldquo;{gap.mentionedText}&rdquo;</em>{" "}
              — tratamento não cadastrado. Considere adicioná-lo.
            </span>
            <button
              onClick={() => dismiss(gap.mentionedText)}
              disabled={dismissing.has(gap.mentionedText)}
              title="Dispensar sugestão"
              style={{
                background: "none",
                border: "none",
                cursor: dismissing.has(gap.mentionedText) ? "default" : "pointer",
                color: "var(--muted)",
                padding: 2,
                display: "flex",
                opacity: dismissing.has(gap.mentionedText) ? 0.4 : 1,
                flexShrink: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
