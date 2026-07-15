"use client";

/**
 * Subpágina de detalhe do Estudo de Setup (ADR-002) — mirror estrutural da
 * subpágina irmã `revisao-conversas/[reviewId]` (ReviewWorkbench). O resumo
 * e as ações de status (Gerar Novamente/Aprovar e enviar/Concluir estudo)
 * continuam no card compacto da página da clínica (setup-study-ui.tsx);
 * aqui vive só a lista completa de findings com a curadoria/aplicação.
 *
 * Polish visual (sem mudar comportamento): categoria vira chip colorido por
 * tipo, severidade combina numeração + cor pra escanear rápido uma lista de
 * até ~15 itens, e a proposta de alteração usa rótulo amigável (o target
 * técnico como `treatment:<uuid>.priceCents` vira "Preço do tratamento",
 * com o valor técnico preservado via `title` para quem precisar dele).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Trash2,
  Pencil,
  Check,
  X,
  Wand2,
  CheckCheck,
  DollarSign,
  MessageCircle,
  ListChecks,
  ShieldCheck,
  Mic,
  MoreHorizontal,
} from "lucide-react";
import {
  deleteSetupFinding,
  updateSetupFindingClaim,
  applySetupFinding,
} from "../../setup-study-actions";
import type { SetupFinding, SetupFindingCategory, SetupStudyStatus } from "@/domain/entities/setup-study";

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

/** Cor + rótulo por categoria — mesma lógica de "ícone com cor própria por
 * papel" usada em conversas-ui.tsx, adaptada aos tokens do painel owner. */
const CATEGORY_META: Record<
  SetupFindingCategory,
  { label: string; icon: typeof Sparkles; color: string; bg: string }
> = {
  price: { label: "Preço", icon: DollarSign, color: "var(--cold)", bg: "var(--cold-soft)" },
  communication: { label: "Comunicação", icon: MessageCircle, color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  qualification: { label: "Qualificação", icon: ListChecks, color: "var(--accent)", bg: "var(--accent-soft)" },
  policy: { label: "Política", icon: ShieldCheck, color: "#6366f1", bg: "rgba(99,102,241,0.12)" },
  tone: { label: "Tom de voz", icon: Mic, color: "#ec4899", bg: "rgba(236,72,153,0.12)" },
  other: { label: "Outro", icon: MoreHorizontal, color: "var(--muted)", bg: "var(--surface-soft)" },
};

/** Cor + rótulo por severidade. O nº do apontamento herda essa cor (ver
 * badge numerado em FindingRow) pra que os itens críticos saltem aos olhos
 * mesmo rolando rápido uma lista longa; o rótulo textual (não só a cor)
 * garante que a leitura não dependa de percepção de cor. */
const SEVERITY_META: Record<
  1 | 2 | 3,
  { label: string; icon: typeof Sparkles; color: string; bg: string; border: string }
> = {
  3: { label: "Crítico", icon: AlertTriangle, color: "var(--hot)", bg: "var(--hot-soft)", border: "rgba(239,68,68,0.4)" },
  2: { label: "Atenção", icon: Info, color: "var(--warm)", bg: "var(--warm-soft)", border: "rgba(245,158,11,0.35)" },
  1: { label: "Informativo", icon: CheckCircle2, color: "var(--muted)", bg: "var(--surface-soft)", border: "var(--line)" },
};

/** Rótulo amigável do target técnico de uma proposta de alteração (o dado
 * em si — `finding.proposedChange.target` — não muda, só a apresentação). */
function describeTarget(target: string): string {
  if (target.startsWith("treatment:")) {
    const field = target.split(".").pop() ?? "";
    const FIELD_LABELS: Record<string, string> = {
      priceCents: "Preço do tratamento",
      priceQuotableInChat: "Preço informável no chat",
      aliases: "Nomes alternativos do tratamento",
      requiresEvaluationFirst: "Exige avaliação prévia",
    };
    return FIELD_LABELS[field] ?? "Campo do tratamento";
  }
  const STATIC_LABELS: Record<string, string> = {
    "playbook.objections[]": "Objeção do playbook",
    "playbook.toneOfVoice": "Tom de voz do playbook",
    "playbook.commercialPolicy": "Política comercial",
    "playbook.notes": "Notas do playbook",
  };
  return STATIC_LABELS[target] ?? target;
}

/** Formata o valor de um diff de proposta pra leitura humana (ex.: centavos
 * → R$ 150,00; booleano em string → Sim/Não). Puramente de apresentação. */
function formatDiffValue(target: string, raw: string): string {
  if (!raw) return "(vazio)";
  if (target.endsWith(".priceCents")) {
    const cents = Number(raw);
    if (Number.isFinite(cents)) {
      return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }
  }
  if (target.endsWith(".priceQuotableInChat") || target.endsWith(".requiresEvaluationFirst")) {
    if (raw === "true") return "Sim";
    if (raw === "false") return "Não";
  }
  return raw;
}

function pillStyle(color: string, bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    color,
    background: bg,
    padding: "4px 9px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  };
}

export function SetupStudyDetail({
  clinicId,
  study,
}: {
  clinicId: string;
  study: SetupStudyDetailViewModel;
}) {
  const isDraft = study.status === "draft";
  const criticalCount = study.findings.filter((f) => f.severity === 3).length;
  const attentionCount = study.findings.filter((f) => f.severity === 2).length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: "var(--accent)" }} />
            Apontamentos ({study.findings.length})
          </h2>
          {criticalCount > 0 && (
            <span style={pillStyle("var(--hot)", "var(--hot-soft)")}>
              <AlertTriangle size={12} /> {criticalCount} crítico{criticalCount > 1 ? "s" : ""}
            </span>
          )}
          {attentionCount > 0 && (
            <span style={pillStyle("var(--warm)", "var(--warm-soft)")}>
              <Info size={12} /> {attentionCount} atenção
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{STATUS_LABELS[study.status]}</span>
      </div>

      {study.findings.length === 0 ? (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--surface)",
            padding: "32px 24px",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          Nenhum apontamento restante. Gere um novo estudo ou ajuste o período.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {study.findings.map((finding, idx) => (
            <FindingRow
              key={finding.id}
              clinicId={clinicId}
              studyId={study.id}
              finding={finding}
              editable={isDraft}
              studyStatus={study.status}
              index={idx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FindingRowProps {
  clinicId: string;
  studyId: string;
  finding: SetupFinding;
  editable: boolean;
  studyStatus: SetupStudyStatus;
  index: number;
}

function FindingRow({ clinicId, studyId, finding, editable, studyStatus, index }: FindingRowProps) {
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

  const severity = SEVERITY_META[finding.severity];
  const category = CATEGORY_META[finding.category];
  const CategoryIcon = category.icon;
  const SeverityIcon = severity.icon;

  return (
    <div
      style={{
        border: `1px solid ${finding.severity === 3 ? "rgba(239,68,68,0.35)" : "var(--line)"}`,
        borderRadius: 14,
        background: finding.severity === 3 ? "rgba(239,68,68,0.045)" : "var(--surface)",
        padding: "16px 18px",
        display: "grid",
        gap: 12,
        opacity: isPending ? 0.5 : 1,
        transition: "opacity 160ms ease, border-color 160ms ease, background 160ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Numeração + severidade combinadas: a cor do nº já denuncia os
            itens críticos/atenção ao rolar rápido, sem precisar caçar um
            ícone pequeno solto. */}
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: "50%",
            fontSize: 11,
            fontWeight: 800,
            color: severity.color,
            background: severity.bg,
            border: `1px solid ${severity.border}`,
          }}
        >
          {index + 1}
        </span>

        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={pillStyle(category.color, category.bg)}>
              <CategoryIcon size={12} /> {category.label}
            </span>

            {finding.severity >= 2 && (
              <span style={pillStyle(severity.color, severity.bg)}>
                <SeverityIcon size={12} /> {severity.label}
              </span>
            )}

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
                    aria-label="Editar apontamento"
                    style={curationBtnStyle}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  title="Remover apontamento"
                  aria-label="Remover apontamento"
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
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                value={draftClaim}
                onChange={(e) => setDraftClaim(e.target.value.slice(0, 280))}
                rows={3}
                autoFocus
                style={{ width: "100%", resize: "vertical", fontSize: 14, lineHeight: 1.4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={handleSaveClaim} disabled={isPending || !draftClaim.trim()} aria-label="Salvar apontamento" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <Check size={13} /> Salvar
                </button>
                <button onClick={handleCancel} disabled={isPending} aria-label="Cancelar edição" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <X size={13} /> Cancelar
                </button>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{draftClaim.length}/280</span>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
              {finding.claim}
            </p>
          )}

          {/* Evidence quote — rótulo curto pra orientar quem está escaneando
              vários itens seguidos (antes era só um bloco itálico solto). */}
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Evidência
            </span>
            <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 6, borderLeft: "2px solid var(--line)", fontSize: 13, color: "var(--muted)", fontStyle: "italic", lineHeight: 1.5 }}>
              &quot;{finding.evidence}&quot;
            </div>
          </div>

          {/* Correção enviada pelo cliente (Fase 2) */}
          {finding.answer?.status === "corrected" && finding.answer.correction && (
            <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.06)", borderRadius: 6, borderLeft: "2px solid #f59e0b", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#f59e0b", marginBottom: 3 }}>
                Correção do cliente
              </span>
              {finding.answer.correction}
            </div>
          )}

          {/* Proposed Change preview se houver — rótulo amigável do campo
              (o target técnico fica disponível via title, no hover). */}
          {finding.proposedChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, background: "var(--surface-soft)", padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--line)" }}>
              <span title={finding.proposedChange.target} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)" }}>
                {describeTarget(finding.proposedChange.target)}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: "2px 8px", borderRadius: 999, textDecoration: "line-through" }}>
                  {formatDiffValue(finding.proposedChange.target, finding.proposedChange.currentValue)}
                </span>
                <ChevronRight size={14} style={{ color: "var(--muted)" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,0.1)", padding: "2px 8px", borderRadius: 999 }}>
                  {formatDiffValue(finding.proposedChange.target, finding.proposedChange.newValue)}
                </span>
              </span>
            </div>
          )}

          {/* Fase 3 — aplicação à config (só em estudo respondido) */}
          {studyStatus === "answered" && (
            <ApplyFindingFooter clinicId={clinicId} studyId={studyId} finding={finding} />
          )}
          {finding.applied && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,0.08)", padding: "6px 10px", borderRadius: 8, width: "fit-content" }}>
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
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", width: "fit-content" }}>
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
      aria-label="Aplicar apontamento à configuração da clínica"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#000",
        fontSize: 13, fontWeight: 700,
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.6 : 1,
        width: "fit-content",
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
