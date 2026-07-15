"use client";

/**
 * UI da página pública de revisão de conversas (docs/product/revisao-conversas-plano.md,
 * seção 6 — copy final, não reescrever). Bolhas estilo WhatsApp, mobile-first,
 * mesmo dark theme/estilo inline de `validacao/[token]/validacao-ui.tsx`.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { answerExcerpt, concludeReview } from "./actions";
import type {
  ConversationExcerpt,
  ExcerptFeedbackRating,
  ExcerptMessage,
  ExcerptRole,
} from "@/domain/entities/conversation-review";
import { MAX_FEEDBACK_TEXT_CHARS } from "@/domain/entities/conversation-review";

/** Rótulos client-facing por papel (Apêndice I — nunca "shadow"/"simulated"). */
const ROLE_LABEL: Record<ExcerptRole, string> = {
  lead: "Paciente",
  ia: "Assistente IA",
  clinica: "Equipe da clínica",
};

/** Lado e cores da bolha por papel (seção 6). */
const BUBBLE_STYLE: Record<
  ExcerptRole,
  { align: "flex-start" | "flex-end"; background: string; border: string }
> = {
  lead: { align: "flex-start", background: "#1f1f23", border: "1px solid transparent" },
  ia: { align: "flex-end", background: "rgba(163,230,53,0.12)", border: "1px solid rgba(163,230,53,0.35)" },
  clinica: { align: "flex-end", background: "#131316", border: "1px dashed #3f3f46" },
};

type LocalFeedback = {
  rating: ExcerptFeedbackRating;
  comment?: string;
  suggestedReply?: string;
};

export function ConversationReviewForm({
  token,
  clinicName,
  excerpts,
}: {
  token: string;
  clinicName: string;
  excerpts: ConversationExcerpt[];
}) {
  const router = useRouter();
  const [concluding, startConclude] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overallComment, setOverallComment] = useState("");

  // Estado local do feedback, inicializado com o que já veio persistido
  // (permite reabrir o link e ver/editar respostas já salvas).
  const [answers, setAnswers] = useState<Record<string, LocalFeedback>>(() => {
    const seed: Record<string, LocalFeedback> = {};
    for (const e of excerpts) {
      if (e.feedback) {
        seed[e.id] = {
          rating: e.feedback.rating,
          comment: e.feedback.comment,
          suggestedReply: e.feedback.suggestedReply,
        };
      }
    }
    return seed;
  });

  const answeredCount = Object.keys(answers).length;

  const recordAnswer = (excerptId: string, feedback: LocalFeedback) =>
    setAnswers((prev) => ({ ...prev, [excerptId]: feedback }));

  const handleConclude = () => {
    setError(null);
    startConclude(async () => {
      try {
        await concludeReview(token, overallComment);
        router.refresh(); // a página passa a resolver o estado "answered"
      } catch (err: unknown) {
        setError((err as Error).message || "Não foi possível concluir.");
      }
    });
  };

  return (
    <div style={{ maxWidth: 560, width: "100%", margin: "0 auto", display: "grid", gap: 20 }}>
      {/* Cabeçalho — copy final da seção 6, não reescrever */}
      <header style={{ display: "grid", gap: 8, paddingTop: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#a3e635", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          SystemOps
        </span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>
          Veja como a assistente atende a {clinicName}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#a1a1aa" }}>
          Estes são trechos reais de conversas recentes — a assistente ainda
          está em observação e nada foi enviado aos seus pacientes. Onde
          estiver bom, toque em 👍. Onde você faria diferente, conte pra
          gente. Leva poucos minutos e deixa a assistente com a cara da sua
          clínica.
        </p>
      </header>

      {/* Progresso — informativo, não bloqueia a conclusão (Apêndice D) */}
      <div style={{ fontSize: 13, color: "#a1a1aa", fontWeight: 600 }}>
        {answeredCount} de {excerpts.length} trechos com feedback
      </div>

      {/* Trechos */}
      <div style={{ display: "grid", gap: 14 }}>
        {excerpts.map((excerpt) => (
          <ExcerptCard
            key={excerpt.id}
            token={token}
            excerpt={excerpt}
            answer={answers[excerpt.id]}
            onAnswered={(feedback) => recordAnswer(excerpt.id, feedback)}
          />
        ))}
      </div>

      {/* Comentário geral + conclusão */}
      <div style={{ display: "grid", gap: 8 }}>
        <textarea
          value={overallComment}
          onChange={(e) => setOverallComment(e.target.value.slice(0, MAX_FEEDBACK_TEXT_CHARS))}
          rows={3}
          placeholder="Algum comentário geral? (opcional)"
          style={{
            width: "100%",
            resize: "vertical",
            fontSize: 15,
            lineHeight: 1.45,
            padding: "12px",
            borderRadius: 10,
            border: "1px solid #27272a",
            background: "#131316",
            color: "#fafafa",
            fontFamily: "inherit",
          }}
        />
      </div>

      {error && (
        <p style={{ margin: 0, fontSize: 14, color: "#f87171", textAlign: "center" }}>{error}</p>
      )}

      <button
        onClick={handleConclude}
        disabled={concluding}
        style={{
          padding: "16px 20px",
          borderRadius: 12,
          border: "none",
          background: "#a3e635",
          color: "#000",
          fontSize: 16,
          fontWeight: 800,
          cursor: concluding ? "not-allowed" : "pointer",
          opacity: concluding ? 0.7 : 1,
          position: "sticky",
          bottom: 12,
        }}
      >
        {concluding ? "Enviando..." : "Concluir revisão"}
      </button>
    </div>
  );
}

function ExcerptCard({
  token,
  excerpt,
  answer,
  onAnswered,
}: {
  token: string;
  excerpt: ConversationExcerpt;
  answer: LocalFeedback | undefined;
  onAnswered: (feedback: LocalFeedback) => void;
}) {
  const [saving, startSave] = useTransition();
  const [adjusting, setAdjusting] = useState(false);
  const [comment, setComment] = useState(answer?.comment ?? "");
  const [suggestedReply, setSuggestedReply] = useState(answer?.suggestedReply ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = (input: { rating: ExcerptFeedbackRating; comment?: string; suggestedReply?: string }) => {
    setError(null);
    startSave(async () => {
      try {
        await answerExcerpt(token, excerpt.id, input);
        onAnswered({ rating: input.rating, comment: input.comment, suggestedReply: input.suggestedReply });
        if (input.rating === "adjust") setAdjusting(false);
      } catch (err: unknown) {
        setError((err as Error).message || "Não foi possível salvar.");
      }
    });
  };

  const isGood = answer?.rating === "good";
  const isAdjust = answer?.rating === "adjust";

  return (
    <div
      style={{
        border: `1px solid ${answer ? "rgba(163,230,53,0.35)" : "#27272a"}`,
        borderRadius: 14,
        background: answer ? "rgba(163,230,53,0.04)" : "#131316",
        padding: "18px 18px 16px",
        display: "grid",
        gap: 12,
        opacity: saving ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {excerpt.context ? (
          <p style={{ margin: 0, fontSize: 13, color: "#a1a1aa", fontStyle: "italic", lineHeight: 1.4, flex: 1 }}>
            {excerpt.context}
          </p>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        {answer && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#a3e635", whiteSpace: "nowrap" }}>
            <CheckCircle2 size={14} /> {isGood ? "Ficou bom" : "Vai ajustar"}
          </span>
        )}
      </div>

      {/* Bolhas estilo WhatsApp */}
      <div style={{ display: "grid", gap: 8 }}>
        {excerpt.messages.map((message, idx) => (
          <Bubble key={idx} message={message} />
        ))}
      </div>

      {/* Resumo do ajuste já salvo (fora do modo de edição) */}
      {isAdjust && !adjusting && (comment || suggestedReply) && (
        <div style={{ padding: "10px 12px", background: "rgba(163,230,53,0.06)", borderRadius: 8, fontSize: 14, lineHeight: 1.5, display: "grid", gap: 8 }}>
          {comment && (
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#a3e635", display: "block", marginBottom: 4 }}>
                O que você mudaria
              </span>
              {comment}
            </div>
          )}
          {suggestedReply && (
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#a3e635", display: "block", marginBottom: 4 }}>
                Como você responderia
              </span>
              {suggestedReply}
            </div>
          )}
        </div>
      )}

      {adjusting ? (
        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_FEEDBACK_TEXT_CHARS))}
            rows={3}
            autoFocus
            placeholder="O que você mudaria? (opcional)"
            style={{ width: "100%", resize: "vertical", fontSize: 15, lineHeight: 1.45, padding: "12px", borderRadius: 10, border: "1px solid #a3e635", background: "#0d0d0f", color: "#fafafa", fontFamily: "inherit" }}
          />
          <textarea
            value={suggestedReply}
            onChange={(e) => setSuggestedReply(e.target.value.slice(0, MAX_FEEDBACK_TEXT_CHARS))}
            rows={3}
            placeholder="Como você responderia? (opcional)"
            style={{ width: "100%", resize: "vertical", fontSize: 15, lineHeight: 1.45, padding: "12px", borderRadius: 10, border: "1px solid #a3e635", background: "#0d0d0f", color: "#fafafa", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => save({ rating: "adjust", comment, suggestedReply })}
              disabled={saving}
              style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#a3e635", color: "#000", fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}
            >
              Salvar
            </button>
            <button
              onClick={() => {
                setAdjusting(false);
                setComment(answer?.comment ?? "");
                setSuggestedReply(answer?.suggestedReply ?? "");
              }}
              disabled={saving}
              style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid #3f3f46", background: "transparent", color: "#a1a1aa", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => save({ rating: "good" })}
            disabled={saving}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: isGood ? "none" : "1px solid #3f3f46",
              background: isGood ? "#a3e635" : "transparent",
              color: isGood ? "#000" : "#fafafa",
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            👍 Ficou bom
          </button>
          <button
            onClick={() => setAdjusting(true)}
            disabled={saving}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: isAdjust ? "none" : "1px solid #3f3f46",
              background: isAdjust ? "#a3e635" : "transparent",
              color: isAdjust ? "#000" : "#fafafa",
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            ✏️ Eu ajustaria
          </button>
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "#f87171" }}>{error}</p>
      )}
    </div>
  );
}

/** Uma bolha de chat — lado, cor e rótulo por papel (seção 6). */
function Bubble({ message }: { message: ExcerptMessage }) {
  const style = BUBBLE_STYLE[message.role];
  const roleLabel = ROLE_LABEL[message.role];
  // wasAudio: prefixo 🎤 e sufixo "(enviada como áudio)" no rótulo (seção 6).
  const label = message.wasAudio ? `🎤 ${roleLabel} (enviada como áudio)` : roleLabel;

  return (
    <div style={{ display: "flex", justifyContent: style.align }}>
      <div style={{ maxWidth: "82%", display: "grid", gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#a1a1aa",
            textAlign: style.align === "flex-start" ? "left" : "right",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {label}
        </span>
        <div
          style={{
            background: style.background,
            border: style.border,
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: 1.45,
            color: "#fafafa",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}
