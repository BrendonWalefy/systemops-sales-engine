"use client";

/**
 * Card do Estudo de Setup na página da clínica do owner (ADR-002).
 * Padrão visual/estrutural mirror do ConversationReviewCard
 * (conversation-review-ui.tsx): card COMPACTO com resumo por status +
 * botão que leva para a subpágina de detalhe (`setup-study/[studyId]`),
 * onde vive a lista completa de findings e a curadoria.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, ChevronRight, ThumbsUp, Pencil, Send, Copy, Clock, CheckCheck, RefreshCw } from "lucide-react";
import {
  generateSetupStudy,
  sendSetupStudyForValidation,
  regenerateSetupStudyValidationLink,
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
  const answered = study.findings.filter((f) => f.answer);
  const confirmedCount = answered.filter((f) => f.answer?.status === "confirmed").length;
  const correctedCount = answered.filter((f) => f.answer?.status === "corrected").length;

  const [isSending, startSend] = useTransition();
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const subpageHref = `/owner/clinics/${clinicId}/setup-study/${study.id}`;

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

  const subpageLabel =
    study.status === "draft"
      ? "Ver e curar apontamentos"
      : study.status === "answered"
        ? "Ver respostas"
        : "Ver apontamentos";

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
          <Link
            href={subpageHref}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, textDecoration: "none",
              background: isDraft ? "var(--accent)" : "var(--surface-soft)",
              border: isDraft ? "none" : "1px solid var(--line)",
              color: isDraft ? "#000" : "var(--text)",
              fontSize: 13, fontWeight: 700,
            }}
          >
            {subpageLabel}
            <ChevronRight size={14} />
          </Link>
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
            {study.findings.length} apontamentos aguardando resposta do cliente.
            {study.expiresAt && ` O link expira em ${study.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}.`}
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

      {/* Resumo por status (o detalhe completo dos findings fica na subpágina) */}
      {isDraft && (
        <div style={{ padding: "14px 20px", fontSize: 13, color: "var(--muted)" }}>
          {study.findings.length === 0
            ? "Nenhum apontamento restante. Gere um novo estudo ou ajuste o período."
            : `${study.findings.length} ${study.findings.length === 1 ? "apontamento" : "apontamentos"} · ${highSeverityCount} ${highSeverityCount === 1 ? "alerta crítico" : "alertas críticos"}.`}
        </div>
      )}

      {study.status === "answered" && (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#22c55e", fontWeight: 700 }}>
            <ThumbsUp size={14} /> {confirmedCount} confirmado{confirmedCount === 1 ? "" : "s"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#f59e0b", fontWeight: 700 }}>
            <Pencil size={14} /> {correctedCount} corrigido{correctedCount === 1 ? "" : "s"}
          </span>
          <span style={{ color: "var(--muted)" }}>
            {study.findings.length - answered.length} sem resposta
          </span>
        </div>
      )}
    </div>
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
