export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronRight, Workflow } from "lucide-react";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getCachedPipelineTreatments } from "../server-data";

const T = {
  bg: "#071115",
  card: "rgba(255,255,255,0.04)",
  cardActive: "rgba(0,224,178,0.08)",
  border: "rgba(255,255,255,0.08)",
  borderActive: "rgba(0,224,178,0.4)",
  teal: "#00E0B2",
  text: "#E6F2EE",
  textSec: "#9AA7A1",
  textMuted: "#66736F",
  amber: "#F5A524",
  cardRadius: "14px",
} as const;

const STEP_TYPE_LABELS: Record<string, string> = {
  content: "Conteúdo",
  qa: "Q&A",
  photo: "Foto",
  ask_availability: "Disponibilidade",
  offer_slots: "Horários",
  book: "Agendamento",
};

function stepBadgeStyle(type: string) {
  switch (type) {
    case "content":
      return { background: "rgba(0,224,178,0.08)", color: T.teal, border: `1px solid rgba(0,224,178,0.2)` };
    case "qa":
      return { background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" };
    case "photo":
      return { background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" };
    case "ask_availability":
    case "offer_slots":
      return { background: "rgba(245,165,36,0.1)", color: T.amber, border: "1px solid rgba(245,165,36,0.2)" };
    case "book":
      return { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" };
    default:
      return { background: "rgba(255,255,255,0.05)", color: T.textMuted, border: `1px solid ${T.border}` };
  }
}

export default async function PipelinePage() {
  const clinicId = await requireSessionClinicId();
  const treatments = await getCachedPipelineTreatments(clinicId);

  const configured = treatments.filter((t) => (t.pipelineSteps?.length ?? 0) > 0).length;
  const total = treatments.length;
  const pct = total > 0 ? Math.round((configured / total) * 100) : 0;

  return (
    <div style={{ width: "100%", maxWidth: "720px", padding: "0 0 40px" }}>

      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <div style={{
            width: "32px", height: "32px", borderRadius: "8px",
            background: "rgba(0,224,178,0.08)", border: "1px solid rgba(0,224,178,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            color: T.teal,
          }}>
            <Workflow size={15} strokeWidth={1.8} />
          </div>
          <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: T.text }}>
            Pipeline de Conversa
          </h1>
        </div>
        <p style={{ margin: "0 0 0 42px", fontSize: "13px", color: T.textSec }}>
          Configure a sequência de etapas que a IA conduz para cada procedimento
        </p>
      </div>

      {/* Progress */}
      {total > 0 && (
        <div style={{ marginBottom: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Progresso
            </p>
            <span style={{ fontSize: "12px", fontWeight: 700, color: configured === total ? T.teal : T.textMuted }}>
              {configured}/{total} configurados
            </span>
          </div>
          <div style={{ height: "4px", borderRadius: "999px", background: T.border, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct}%`, borderRadius: "999px",
              background: configured === total ? T.teal : T.amber,
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

      {/* List */}
      {treatments.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
          padding: "40px 24px", textAlign: "center",
          background: T.card, border: `1px dashed ${T.border}`, borderRadius: T.cardRadius,
        }}>
          <Workflow size={28} strokeWidth={1.5} style={{ color: T.textMuted }} />
          <div>
            <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 600, color: T.textSec }}>
              Nenhum procedimento cadastrado
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: T.textMuted }}>
              <Link href="/app/settings/playbook" style={{ color: T.teal }}>Adicione procedimentos</Link>{" "}
              antes de configurar pipelines.
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: T.cardRadius, overflow: "hidden",
        }}>
          {treatments.map((t, idx) => {
            const stepCount = t.pipelineSteps?.length ?? 0;
            const hasPipeline = stepCount > 0;
            const isLast = idx === treatments.length - 1;

            return (
              <Link
                key={t.id}
                href={`/app/settings/pipeline/${t.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "14px 18px",
                  background: hasPipeline ? "rgba(0,224,178,0.03)" : "transparent",
                  textDecoration: "none", color: "inherit",
                  borderBottom: isLast ? "none" : `1px solid ${T.border}`,
                  borderLeft: hasPipeline ? `3px solid rgba(0,224,178,0.5)` : "3px solid transparent",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: "0 0 4px", fontWeight: 600, fontSize: "14px", color: T.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t.name}
                  </p>
                  {!hasPipeline ? (
                    <span style={{
                      fontSize: "11px", fontWeight: 600,
                      color: T.textMuted, display: "inline-flex", alignItems: "center", gap: "4px",
                      background: T.card, border: `1px solid ${T.border}`,
                      padding: "2px 8px", borderRadius: "6px",
                    }}>
                      Configurar pipeline →
                    </span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                      {t.pipelineSteps!.map((s, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: "10px", fontWeight: 600,
                            padding: "2px 7px", borderRadius: "5px",
                            ...stepBadgeStyle(s.type),
                          }}
                        >
                          {STEP_TYPE_LABELS[s.type] ?? s.type}
                        </span>
                      ))}
                      <span style={{ fontSize: "11px", color: T.textMuted, marginLeft: "2px" }}>
                        · {stepCount} {stepCount === 1 ? "etapa" : "etapas"}
                      </span>
                    </div>
                  )}
                </div>
                <ChevronRight size={14} strokeWidth={2} style={{ color: T.textMuted, flexShrink: 0 }} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
