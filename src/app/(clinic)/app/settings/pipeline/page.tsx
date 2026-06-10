export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronRight, Workflow, AlertCircle } from "lucide-react";
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

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Workflow size={22} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
            Pipeline de Conversa
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
            Configure a sequência de etapas que a IA conduz para cada procedimento
          </p>
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
          }}
        >
          <AlertCircle size={32} strokeWidth={1.5} />
          <p style={{ fontSize: "14px" }}>
            Nenhum procedimento cadastrado.{" "}
            <Link href="/app/settings/playbook" style={{ color: "var(--accent)" }}>
              Adicione procedimentos
            </Link>{" "}
            primeiro.
          </p>
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
            maxWidth: "640px",
          }}
        >
          {treatments.map((t) => {
            const stepCount = t.pipelineSteps?.length ?? 0;
            const activeSteps = t.pipelineSteps?.filter(
              (s) => s.type === "content" || s.type === "qa" || s.type === "photo",
            );
            return (
              <Link
                key={t.id}
                href={`/app/settings/pipeline/${t.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "16px 20px",
                  background: "var(--surface)",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>{t.name}</div>
                  {stepCount === 0 ? (
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--muted)",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "6px",
                        padding: "2px 8px",
                      }}
                    >
                      Sem pipeline
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
                      {activeSteps && activeSteps.length > 0 && (
                        <span style={{ fontSize: "12px", color: "var(--muted)", marginLeft: "4px" }}>
                          · {stepCount} {stepCount === 1 ? "etapa" : "etapas"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronRight size={16} strokeWidth={2} style={{ color: "var(--muted)", flexShrink: 0 }} />
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
