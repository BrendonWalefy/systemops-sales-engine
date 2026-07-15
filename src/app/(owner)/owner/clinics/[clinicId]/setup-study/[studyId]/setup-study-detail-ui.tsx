"use client";

/**
 * Subpágina de detalhe do Estudo de Setup (ADR-002) — mirror estrutural da
 * subpágina irmã `revisao-conversas/[reviewId]` (ReviewWorkbench). O resumo
 * e as ações de status (Gerar Novamente/Aprovar e enviar/Concluir estudo)
 * continuam no card compacto da página da clínica (setup-study-ui.tsx);
 * aqui vive só a lista completa de findings com a curadoria/aplicação.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertTriangle, CheckCircle2, ChevronRight, Info, Trash2, Pencil, Check, X, Wand2, CheckCheck } from "lucide-react";
import {
  deleteSetupFinding,
  updateSetupFindingClaim,
  applySetupFinding,
} from "../../setup-study-actions";
import type { SetupFinding, SetupStudyStatus } from "@/domain/entities/setup-study";

export interface SetupStudyDetailViewModel {
  id: string;
  status: SetupStudyStatus;
  createdAt: string;
  findings: SetupFinding[];
}

const STATUS_LABELS: Record<SetupStudyStatus, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  answered: "Respondido",
  applied: "Concluído",
  expired: "Expirado",
};

export function SetupStudyDetail({
  clinicId,
  study,
}: {
  clinicId: string;
  study: SetupStudyDetailViewModel;
}) {
  const isDraft = study.status === "draft";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: "var(--accent)" }} />
            Apontamentos ({study.findings.length})
          </h2>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{STATUS_LABELS[study.status]}</span>
        </div>

        {study.findings.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            Nenhum apontamento restante. Gere um novo estudo ou ajuste o período.
          </div>
        ) : (
          study.findings.map((finding, idx) => (
            <FindingRow
              key={finding.id}
              clinicId={clinicId}
              studyId={study.id}
              finding={finding}
              editable={isDraft}
              studyStatus={study.status}
              isLast={idx === study.findings.length - 1}
            />
          ))
        )}
      </section>
    </div>
  );
}

interface FindingRowProps {
  clinicId: string;
  studyId: string;
  finding: SetupFinding;
  editable: boolean;
  studyStatus: SetupStudyStatus;
  isLast: boolean;
}

function FindingRow({ clinicId, studyId, finding, editable, studyStatus, isLast }: FindingRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draftClaim, setDraftClaim] = useState(finding.claim);

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteSetupFinding(clinicId, studyId, finding.id);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao remover apontamento.");
      }
    });
  };

  const handleSaveClaim = () => {
    const trimmed = draftClaim.trim();
    if (!trimmed) return;
    if (trimmed === finding.claim) {
      setIsEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateSetupFindingClaim(clinicId, studyId, finding.id, trimmed);
        setIsEditing(false);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao salvar apontamento.");
      }
    });
  };

  const handleCancel = () => {
    setDraftClaim(finding.claim);
    setIsEditing(false);
  };

  return (
    <div
      style={{
        padding: "16px 20px",
        borderBottom: !isLast ? "1px solid var(--line)" : "none",
        display: "grid",
        gap: 12,
        background: finding.severity === 3 ? "rgba(239,68,68,0.03)" : "transparent",
        opacity: isPending ? 0.5 : 1,
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
            {/* Ações de curadoria — só no rascunho */}
            {editable && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    disabled={isPending}
                    title="Editar apontamento"
                    style={curationBtnStyle}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  title="Remover apontamento"
                  style={{ ...curationBtnStyle, color: "#ef4444" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
            {/* Selo de resposta do cliente (fases 2/3) */}
            {finding.answer && (
              <span style={{ marginLeft: editable ? 0 : "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: finding.answer.status === "confirmed" ? "#22c55e" : "#f59e0b" }}>
                <CheckCircle2 size={13} /> {finding.answer.status === "confirmed" ? "Confirmado" : "Corrigido"}
              </span>
            )}
          </div>

          {isEditing && editable ? (
            <div style={{ display: "grid", gap: 8, margin: "0 0 8px" }}>
              <textarea
                value={draftClaim}
                onChange={(e) => setDraftClaim(e.target.value.slice(0, 280))}
                rows={3}
                autoFocus
                style={{ width: "100%", resize: "vertical", fontSize: 14, lineHeight: 1.4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={handleSaveClaim} disabled={isPending || !draftClaim.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <Check size={13} /> Salvar
                </button>
                <button onClick={handleCancel} disabled={isPending} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <X size={13} /> Cancelar
                </button>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{draftClaim.length}/280</span>
              </div>
            </div>
          ) : (
            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
              {finding.claim}
            </p>
          )}

          {/* Evidence quote */}
          <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 6, borderLeft: "2px solid var(--line)", fontSize: 13, color: "var(--muted)", fontStyle: "italic", lineHeight: 1.5 }}>
            &quot;{finding.evidence}&quot;
          </div>

          {/* Correção enviada pelo cliente (Fase 2) */}
          {finding.answer?.status === "corrected" && finding.answer.correction && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(245,158,11,0.06)", borderRadius: 6, borderLeft: "2px solid #f59e0b", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#f59e0b", marginBottom: 3 }}>
                Correção do cliente
              </span>
              {finding.answer.correction}
            </div>
          )}

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

          {/* Fase 3 — aplicação à config (só em estudo respondido) */}
          {studyStatus === "answered" && (
            <ApplyFindingFooter clinicId={clinicId} studyId={studyId} finding={finding} />
          )}
          {finding.applied && (
            <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,0.08)", padding: "6px 10px", borderRadius: 8 }}>
              <CheckCheck size={14} /> Aplicado: {finding.applied.summary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Rodapé de aplicação de um finding (ADR-002 Fase 3). Mostra o botão "Aplicar à
 * config" quando há uma resposta do cliente que gera escrita; informativos
 * confirmados (sem proposta) aparecem como somente-registro.
 */
function ApplyFindingFooter({
  clinicId,
  studyId,
  finding,
}: {
  clinicId: string;
  studyId: string;
  finding: SetupFinding;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (finding.applied) return null;

  // Sem resposta → o cliente ainda não validou este item (não deveria ocorrer
  // em estudo "answered", mas é defensivo).
  if (!finding.answer) return null;

  // Informativo confirmado (sem proposta e sem correção) → nada a aplicar.
  const hasWrite =
    finding.answer.status === "corrected" || finding.proposedChange !== null;
  if (!hasWrite) {
    return (
      <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
        <Info size={13} /> Informativo — sem alteração automática.
      </div>
    );
  }

  const handleApply = () => {
    if (!confirm("Aplicar este apontamento à configuração da clínica?")) return;
    startTransition(async () => {
      try {
        await applySetupFinding(clinicId, studyId, finding.id);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao aplicar.");
      }
    });
  };

  return (
    <button
      onClick={handleApply}
      disabled={isPending}
      style={{
        marginTop: 12,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#000",
        fontSize: 13, fontWeight: 700,
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.6 : 1,
      }}
    >
      <Wand2 size={14} /> {isPending ? "Aplicando..." : "Aplicar à config"}
    </button>
  );
}

const curationBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface-soft)",
  color: "var(--muted)",
  cursor: "pointer",
};
