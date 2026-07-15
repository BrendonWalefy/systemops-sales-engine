"use client";

/**
 * Card da Revisão de Conversas na página da clínica do owner
 * (docs/product/revisao-conversas-plano.md, seção 7). Padrão visual do
 * SetupStudyCard: rodada atual + status + respostas quando answered;
 * histórico compacto das rodadas anteriores. A curadoria acontece na
 * subpágina `revisao-conversas/[reviewId]`.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MessagesSquare,
  Clock,
  ChevronRight,
  ThumbsUp,
  Pencil,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { createReview, expireReview } from "./conversation-review-actions";
import type {
  ConversationExcerpt,
  ConversationReviewStatus,
} from "@/domain/entities/conversation-review";
import {
  MIN_EXCERPTS_PER_REVIEW,
  MAX_EXCERPTS_PER_REVIEW,
} from "@/domain/entities/conversation-review";

export function CreateReviewButton({ clinicId }: { clinicId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleCreate = () => {
    const suggestion = `Rodada — semana de ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
    const title = prompt("Título da rodada:", suggestion);
    if (title === null) return; // cancelou
    startTransition(async () => {
      try {
        const { reviewId } = await createReview(clinicId, title);
        router.push(`/owner/clinics/${clinicId}/revisao-conversas/${reviewId}`);
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao criar rodada.");
      }
    });
  };

  return (
    <button
      onClick={handleCreate}
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
      <MessagesSquare size={16} />
      {isPending ? "Criando rodada..." : "Nova rodada"}
    </button>
  );
}

export interface ReviewHistoryItem {
  id: string;
  title: string;
  status: ConversationReviewStatus;
  createdAt: Date;
}

interface ConversationReviewCardProps {
  clinicId: string;
  review: {
    id: string;
    status: ConversationReviewStatus;
    title: string;
    excerpts: ConversationExcerpt[];
    overallComment: string | null;
    createdAt: Date;
    sentAt: Date | null;
    answeredAt: Date | null;
    expiresAt: Date | null;
  };
  history: ReviewHistoryItem[];
}

const STATUS_LABELS: Record<ConversationReviewStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  answered: "Respondida",
  expired: "Expirada",
};

export function ConversationReviewCard({ clinicId, review, history }: ConversationReviewCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const subpageHref = `/owner/clinics/${clinicId}/revisao-conversas/${review.id}`;
  const answered = review.excerpts.filter((e) => e.feedback);
  const goodCount = answered.filter((e) => e.feedback?.rating === "good").length;
  const adjustCount = answered.filter((e) => e.feedback?.rating === "adjust").length;

  const statusMeta = (() => {
    switch (review.status) {
      case "sent":
        return { title: "Revisão enviada — aguardando cliente", tone: "#f59e0b" as const };
      case "answered":
        return { title: "Revisão respondida pelo cliente", tone: "#22c55e" as const };
      default:
        return { title: "Revisão de conversas (Rascunho)", tone: "var(--accent)" as const };
    }
  })();

  const handleExpire = () => {
    const msg =
      review.status === "sent"
        ? "Expirar esta rodada? O link enviado ao cliente deixará de funcionar."
        : "Descartar esta rodada em rascunho? Os trechos curados serão perdidos.";
    if (!confirm(msg)) return;
    startTransition(async () => {
      try {
        await expireReview(clinicId, review.id);
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao expirar rodada.");
      }
    });
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessagesSquare size={16} style={{ color: statusMeta.tone }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{statusMeta.title}</h3>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            {review.title} · criada em{" "}
            {review.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {(review.status === "draft" || review.status === "sent") && (
            <button
              onClick={handleExpire}
              disabled={isPending}
              title={review.status === "sent" ? "Invalida o link enviado" : "Descarta o rascunho"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)",
                background: "transparent", color: "#ef4444",
                fontSize: 12, fontWeight: 700,
                cursor: isPending ? "not-allowed" : "pointer",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              <Trash2 size={13} /> {review.status === "sent" ? "Expirar" : "Descartar"}
            </button>
          )}
          <Link
            href={subpageHref}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, textDecoration: "none",
              background: review.status === "draft" ? "var(--accent)" : "var(--surface-soft)",
              border: review.status === "draft" ? "none" : "1px solid var(--line)",
              color: review.status === "draft" ? "#000" : "var(--text)",
              fontSize: 13, fontWeight: 700,
            }}
          >
            {review.status === "draft"
              ? "Abrir curadoria"
              : review.status === "answered"
                ? "Ver respostas"
                : "Ver trechos"}
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* Corpo por status */}
      {review.status === "draft" && (
        <div style={{ padding: "14px 20px", fontSize: 13, color: "var(--muted)" }}>
          {review.excerpts.length} de {MAX_EXCERPTS_PER_REVIEW} trechos curados
          {review.excerpts.length < MIN_EXCERPTS_PER_REVIEW &&
            ` — adicione ao menos ${MIN_EXCERPTS_PER_REVIEW} para enviar`}
          .
        </div>
      )}

      {review.status === "sent" && (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
          <Clock size={15} style={{ color: "#f59e0b" }} />
          <span>
            {review.excerpts.length} trechos aguardando o feedback do cliente.
            {review.expiresAt &&
              ` O link expira em ${review.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}.`}
            {" "}O link só é exibido no momento do envio, por segurança.
          </span>
        </div>
      )}

      {review.status === "answered" && (
        <div style={{ padding: "14px 20px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#22c55e", fontWeight: 700 }}>
              <ThumbsUp size={14} /> {goodCount} ficou bom
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#f59e0b", fontWeight: 700 }}>
              <Pencil size={14} /> {adjustCount} ajustaria
            </span>
            <span style={{ color: "var(--muted)" }}>
              {review.excerpts.length - answered.length} sem resposta ·{" "}
              respondida em{" "}
              {review.answeredAt?.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {review.overallComment && (
            <div style={{ padding: "10px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 8, borderLeft: "2px solid #22c55e", fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#22c55e", marginBottom: 3 }}>
                Comentário geral do cliente
              </span>
              {review.overallComment}
            </div>
          )}
        </div>
      )}

      {/* Histórico compacto */}
      {history.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 20px", display: "grid", gap: 6 }}>
          <p className="eyebrow" style={{ margin: 0 }}>Rodadas anteriores</p>
          {history.map((item) => (
            <Link
              key={item.id}
              href={`/owner/clinics/${clinicId}/revisao-conversas/${item.id}`}
              style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
            >
              {item.status === "answered" ? (
                <CheckCircle2 size={13} style={{ color: "#22c55e" }} />
              ) : (
                <Clock size={13} style={{ color: "var(--muted)" }} />
              )}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title}
              </span>
              <span style={{ fontSize: 12 }}>{STATUS_LABELS[item.status]}</span>
              <span style={{ fontSize: 12 }}>
                {item.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
