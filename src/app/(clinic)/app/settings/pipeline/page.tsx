export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronRight, Workflow, AlertCircle, CheckCircle2 } from "lucide-react";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";

const STEP_TYPE_LABELS: Record<string, string> = {
  content: "Conteúdo",
  qa: "Q&A",
  photo: "Foto",
  ask_availability: "Disponibilidade",
  offer_slots: "Horários",
  book: "Agendamento",
};

export default async function PipelinePage() {
  const clinicId = await requireSessionClinicId();
  const treatments = await new DrizzleTreatmentRepository().listByClinic(clinicId);

  const configured = treatments.filter((t) => (t.pipelineSteps?.length ?? 0) > 0).length;
  const total = treatments.length;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Workflow size={20} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
              Pipeline de Conversa
            </h1>
            <p>Configure a sequência de etapas que a IA conduz para cada procedimento</p>
          </div>

          {total > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px", flexShrink: 0 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                fontWeight: 600,
                color: configured === total ? "var(--accent-strong)" : "var(--muted)",
              }}>
                {configured === total && <CheckCircle2 size={13} strokeWidth={2} />}
                {configured}/{total} configurados
              </div>
              <div style={{
                width: "100px",
                height: "4px",
                borderRadius: "999px",
                background: "var(--line)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${total > 0 ? Math.round((configured / total) * 100) : 0}%`,
                  borderRadius: "999px",
                  background: configured === total ? "var(--accent)" : "var(--warm)",
                  transition: "width 0.4s ease",
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {treatments.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            padding: "48px 24px",
            color: "var(--muted)",
            textAlign: "center",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: "12px",
          }}
        >
          <AlertCircle size={32} strokeWidth={1.5} />
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-soft)", marginBottom: "4px" }}>
              Nenhum procedimento cadastrado
            </p>
            <p style={{ fontSize: "13px", margin: 0 }}>
              <Link href="/app/settings/playbook" style={{ color: "var(--accent)" }}>
                Adicione procedimentos
              </Link>{" "}
              antes de configurar pipelines.
            </p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1px",
            background: "var(--line)",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          {treatments.map((t) => {
            const stepCount = t.pipelineSteps?.length ?? 0;
            const hasPipeline = stepCount > 0;
            return (
              <Link
                key={t.id}
                href={`/app/settings/pipeline/${t.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "14px 18px",
                  background: "var(--surface)",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.15s",
                  borderLeft: hasPipeline
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: "14px",
                    marginBottom: "5px",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {t.name}
                  </div>
                  {!hasPipeline ? (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--warm)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        background: "rgba(245,158,11,0.08)",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        border: "1px solid rgba(245,158,11,0.18)",
                        fontWeight: 600,
                      }}
                    >
                      Configurar pipeline →
                    </span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      {t.pipelineSteps!.map((s, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "6px",
                            ...stepBadgeStyle(s.type),
                          }}
                        >
                          {STEP_TYPE_LABELS[s.type] ?? s.type}
                        </span>
                      ))}
                      <span style={{ fontSize: "11.5px", color: "var(--muted)", marginLeft: "2px" }}>
                        · {stepCount} {stepCount === 1 ? "etapa" : "etapas"}
                      </span>
                    </div>
                  )}
                </div>
                <ChevronRight size={15} strokeWidth={2} style={{ color: "var(--muted)", flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function stepBadgeStyle(type: string): React.CSSProperties {
  switch (type) {
    case "content":
      return { background: "rgba(0,212,170,0.1)", color: "#00d4aa", border: "1px solid rgba(0,212,170,0.2)" };
    case "qa":
      return { background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" };
    case "photo":
      return { background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" };
    case "ask_availability":
    case "offer_slots":
      return { background: "rgba(245,158,11,0.1)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" };
    case "book":
      return { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" };
    default:
      return { background: "rgba(255,255,255,0.05)", color: "var(--muted)", border: "1px solid rgba(255,255,255,0.08)" };
  }
}
