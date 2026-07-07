"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertTriangle, CheckCircle2, ChevronRight, Info, Trash2, Pencil, Check, X, Send, Copy, Clock, Wand2, CheckCheck, RefreshCw } from "lucide-react";
import {
  generateSetupStudy,
  deleteSetupFinding,
  updateSetupFindingClaim,
  sendSetupStudyForValidation,
  regenerateSetupStudyValidationLink,
  applySetupFinding,
  finalizeSetupStudy,
} from "./setup-study-actions";
import type { SetupFinding, SetupStudyStatus } from "@/domain/entities/setup-study";

interface GenerateSetupStudyButtonProps {
  clinicId: string;
}

export function GenerateSetupStudyButton({ clinicId }: GenerateSetupStudyButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        const res = await generateSetupStudy(clinicId);
        if (res && res.error) {
          alert(res.error);
          return;
        }
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
  clinicId: string;
  study: {
    id: string;
    status: SetupStudyStatus;
    createdAt: Date;
    sentAt: Date | null;
    expiresAt: Date | null;
    findings: SetupFinding[];
  };
}

export function SetupStudyCard({ clinicId, study }: SetupStudyCardProps) {
  const isDraft = study.status === "draft";
  const highSeverityCount = study.findings.filter((f) => f.severity === 3).length;
  const answeredCount = study.findings.filter((f) => f.answer).length;

  const [isSending, startSend] = useTransition();
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const handleSend = () => {
    if (!confirm("Enviar este estudo para validação do cliente? Depois de enviado, o rascunho não poderá mais ser editado.")) return;
    startSend(async () => {
      try {
        const { url } = await sendSetupStudyForValidation(clinicId, study.id);
        setSentLink(url); // link exibido uma única vez
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao enviar para validação.");
      }
    });
  };

  const handleRegenerate = () => {
    if (!confirm("Gerar um novo link de validação? O link anterior deixará de funcionar.")) return;
    startSend(async () => {
      try {
        const { url } = await regenerateSetupStudyValidationLink(clinicId, study.id);
        setSentLink(url); // link exibido uma única vez
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao gerar novo link.");
      }
    });
  };

  const handleCopy = async () => {
    if (!sentLink) return;
    try {
      await navigator.clipboard.writeText(sentLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível — o link já está visível para cópia manual */
    }
  };

  // Estado do cabeçalho por status
  const statusMeta = (() => {
    switch (study.status) {
      case "sent":
        return { title: "Estudo enviado — aguardando cliente", tone: "#f59e0b" as const };
      case "answered":
        return { title: "Respostas recebidas", tone: "#22c55e" as const };
      default:
        return { title: "Estudo de Setup (Rascunho)", tone: "var(--accent)" as const };
    }
  })();

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: statusMeta.tone }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{statusMeta.title}</h3>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {study.status === "answered" && `${answeredCount} de ${study.findings.length} respondidos · `}
            Gerado em {study.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {isDraft && (
            <span style={{ fontSize: 13, fontWeight: 600, color: highSeverityCount > 0 ? "#ef4444" : "var(--muted)" }}>
              {highSeverityCount} {highSeverityCount === 1 ? "alerta crítico" : "alertas críticos"}
            </span>
          )}
          {isDraft && study.findings.length === 0 ? (
            <button
              onClick={() => {
                if(confirm("Descartar este estudo vazio e gerar um novo?")) {
                  startSend(async () => {
                    await generateSetupStudy(clinicId);
                    router.refresh();
                  });
                }
              }}
              disabled={isSending}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line)",
                background: "transparent", color: "var(--muted)",
                fontSize: 13, fontWeight: 700,
                cursor: isSending ? "not-allowed" : "pointer",
                opacity: isSending ? 0.6 : 1,
              }}
            >
              <Sparkles size={14} /> {isSending ? "Gerando..." : "Gerar Novamente"}
            </button>
          ) : isDraft && (
            <button
              onClick={handleSend}
              disabled={isSending || study.findings.length === 0}
              title={study.findings.length === 0 ? "Nenhum apontamento para enviar" : "Aprovar e enviar para validação do cliente"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "var(--accent)", color: "#000",
                fontSize: 13, fontWeight: 700,
                cursor: isSending || study.findings.length === 0 ? "not-allowed" : "pointer",
                opacity: isSending || study.findings.length === 0 ? 0.6 : 1,
              }}
            >
              <Send size={14} /> {isSending ? "Enviando..." : "Aprovar e enviar"}
            </button>
          )}
          {study.status === "answered" && (
            <FinalizeStudyButton clinicId={clinicId} studyId={study.id} />
          )}
        </div>
      </div>

      {/* Link gerado (exibido uma única vez após o envio) */}
      {sentLink && (
        <div style={{ padding: "14px 20px", background: "rgba(34,197,94,0.06)", borderBottom: "1px solid var(--line)", display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Link de validação criado. Copie e envie ao responsável da clínica pelo WhatsApp — <strong>este link só aparece agora</strong>.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, padding: "8px 10px", background: "var(--surface-soft)", borderRadius: 6, border: "1px solid var(--line)" }}>
              {sentLink}
            </code>
            <button onClick={handleCopy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface-soft)", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              <Copy size={13} /> {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <button onClick={() => router.refresh()} style={{ justifySelf: "start", background: "none", border: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
            Já copiei, atualizar
          </button>
        </div>
      )}

      {/* Estado enviado (sem link revelado — já foi mostrado no envio) */}
      {study.status === "sent" && !sentLink && (
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
          <Clock size={15} style={{ color: "#f59e0b" }} />
          <span style={{ flex: 1, minWidth: 220 }}>
            Aguardando o cliente responder pelo link.
            {study.expiresAt && ` Expira em ${study.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}.`}
            {" "}O link só é exibido no momento do envio, por segurança.
          </span>
          <button
            onClick={handleRegenerate}
            disabled={isSending}
            title="Perdeu o link ou ele expirou? Gera um novo — o anterior deixa de funcionar."
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)",
              background: "var(--surface-soft)", color: "var(--text)",
              fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
              cursor: isSending ? "not-allowed" : "pointer",
              opacity: isSending ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} /> {isSending ? "Gerando..." : "Gerar novo link"}
          </button>
        </div>
      )}

      {/* Findings — no rascunho, com curadoria; respondido, mostra respostas */}
      <div style={{ padding: "0" }}>
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
      </div>
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

/** Botão "Concluir estudo" (answered → applied) do cabeçalho (Fase 3). */
function FinalizeStudyButton({ clinicId, studyId }: { clinicId: string; studyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleFinalize = () => {
    if (!confirm("Encerrar o estudo? Os apontamentos não aplicados ficam apenas como registro.")) return;
    startTransition(async () => {
      try {
        await finalizeSetupStudy(clinicId, studyId);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao encerrar estudo.");
      }
    });
  };

  return (
    <button
      onClick={handleFinalize}
      disabled={isPending}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line)",
        background: "var(--surface-soft)", color: "var(--text)",
        fontSize: 13, fontWeight: 600,
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.6 : 1,
      }}
    >
      <CheckCheck size={14} /> {isPending ? "Encerrando..." : "Concluir estudo"}
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
