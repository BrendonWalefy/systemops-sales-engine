"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { generateSetupStudy } from "./setup-study-actions";
import type { SetupFinding } from "@/domain/entities/setup-study";

interface GenerateSetupStudyButtonProps {
  clinicId: string;
}

export function GenerateSetupStudyButton({ clinicId }: GenerateSetupStudyButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        await generateSetupStudy(clinicId);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao gerar estudo.");
      }
    });
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={isPending}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: 10,
        border: "none",
        background: "var(--accent)",
        color: "#000",
        fontSize: 14,
        fontWeight: 700,
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.7 : 1,
      }}
    >
      <Sparkles size={16} />
      {isPending ? "Analisando conversas..." : "Gerar estudo com IA"}
    </button>
  );
}

interface SetupStudyCardProps {
  study: {
    id: string;
    createdAt: Date;
    findings: SetupFinding[];
  };
}

export function SetupStudyCard({ study }: SetupStudyCardProps) {
  const highSeverityCount = study.findings.filter((f) => f.severity === 3).length;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: "var(--accent)" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Estudo de Setup (Rascunho)</h3>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Gerado em {study.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: highSeverityCount > 0 ? "#ef4444" : "var(--muted)" }}>
            {highSeverityCount} {highSeverityCount === 1 ? "alerta crítico" : "alertas críticos"}
          </span>
          <button
            disabled
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-soft)",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "not-allowed",
            }}
            title="Será implementado na Fase 2"
          >
            Aprovar e enviar →
          </button>
        </div>
      </div>

      {/* Findings */}
      <div style={{ padding: "0" }}>
        {study.findings.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            Nenhum apontamento encontrado pelo LLM nas conversas analisadas.
          </div>
        ) : (
          study.findings.map((finding, idx) => (
            <div
              key={finding.id}
              style={{
                padding: "16px 20px",
                borderBottom: idx < study.findings.length - 1 ? "1px solid var(--line)" : "none",
                display: "grid",
                gap: 12,
                background: finding.severity === 3 ? "rgba(239,68,68,0.03)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ paddingTop: 2 }}>
                  {finding.severity === 3 ? (
                    <AlertTriangle size={16} style={{ color: "#ef4444" }} />
                  ) : finding.severity === 2 ? (
                    <Info size={16} style={{ color: "#f59e0b" }} />
                  ) : (
                    <CheckCircle2 size={16} style={{ color: "var(--muted)" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", background: "var(--surface-soft)", padding: "2px 6px", borderRadius: 4 }}>
                      {finding.category}
                    </span>
                    {finding.proposedChange && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
                        Proposta de alteração
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
                    {finding.claim}
                  </p>
                  
                  {/* Evidence quote */}
                  <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 6, borderLeft: "2px solid var(--line)", fontSize: 13, color: "var(--muted)", fontStyle: "italic", lineHeight: 1.5 }}>
                    &quot;{finding.evidence}&quot;
                  </div>

                  {/* Proposed Change preview se houver */}
                  {finding.proposedChange && (
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, fontSize: 12, background: "var(--surface-soft)", padding: "8px 12px", borderRadius: 8, border: "1px dashed var(--line)" }}>
                      <code style={{ color: "var(--muted)" }}>{finding.proposedChange.target}</code>
                      <ChevronRight size={14} style={{ color: "var(--muted)" }} />
                      <span style={{ color: "#ef4444", textDecoration: "line-through" }}>{finding.proposedChange.currentValue || "(vazio)"}</span>
                      <ChevronRight size={14} style={{ color: "var(--muted)" }} />
                      <span style={{ color: "#22c55e", fontWeight: 700 }}>{finding.proposedChange.newValue}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
