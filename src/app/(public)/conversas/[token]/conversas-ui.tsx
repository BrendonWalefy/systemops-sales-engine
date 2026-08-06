"use client";

/**
 * UI da página pública de revisão de conversas (feature catalogada em docs/features.md,
 * seção 6 — copy final, não reescrever). Bolhas estilo WhatsApp, mobile-first,
 * mesmo dark theme/estilo inline de `validacao/[token]/validacao-ui.tsx`.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, User, Bot, Building2 } from "lucide-react";
import { answerExcerpt, concludeReview } from "./actions";
import type {
  PublicConversationExcerpt,
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

/** Ícone e cor do rótulo por papel — reforça a distinção lado a lado (seção 6). */
const ROLE_ICON: Record<ExcerptRole, typeof User> = {
  lead: User,
  ia: Bot,
  clinica: Building2,
};
const ROLE_ICON_COLOR: Record<ExcerptRole, string> = {
  lead: "#a1a1aa",
  ia: "#a3e635",
  clinica: "#d4d4d8",
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
  excerpts: PublicConversationExcerpt[];
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
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 13, color: "#a1a1aa", fontWeight: 600 }}>
          {answeredCount} de {excerpts.length} trechos com feedback
        </div>
        <div style={{ height: 4, borderRadius: 999, background: "#1f1f23", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${excerpts.length ? (answeredCount / excerpts.length) * 100 : 0}%`,
              background: "#a3e635",
              borderRadius: 999,
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      {/* Trechos */}
      <div style={{ display: "grid", gap: 14 }}>
        {excerpts.map((excerpt, index) => (
          <ExcerptCard
            key={excerpt.id}
            index={index}
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

      {/* Wrapper sticky com fade — dá elevação ao CTA sem cortar bruscamente
          os cards que passam por baixo dele ao rolar. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          paddingTop: 24,
          marginTop: 4,
          background: "linear-gradient(to bottom, transparent, #09090b 55%)",
        }}
      >
        <button
          onClick={handleConclude}
          disabled={concluding}
          style={{
            width: "100%",
            padding: "16px 20px",
            borderRadius: 12,
            border: "none",
            background: "#a3e635",
            color: "#000",
            fontSize: 16,
            fontWeight: 800,
            cursor: concluding ? "not-allowed" : "pointer",
            opacity: concluding ? 0.7 : 1,
            marginBottom: 12,
            boxShadow: "0 8px 24px rgba(163,230,53,0.25)",
            transition: "opacity 160ms ease",
          }}
        >
          {concluding ? "Enviando..." : "Concluir revisão"}
        </button>
      </div>
    </div>
  );
}

function ExcerptCard({
  index,
  token,
  excerpt,
  answer,
  onAnswered,
}: {
  index: number;
  token: string;
  excerpt: PublicConversationExcerpt;
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
        transition: "border-color 160ms ease, background 160ms ease, opacity 160ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#1f1f23",
            color: "#a1a1aa",
            fontSize: 11,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        {answer && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
              color: "#a3e635",
              background: "rgba(163,230,53,0.12)",
              border: "1px solid rgba(163,230,53,0.3)",
              borderRadius: 999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
            }}
          >
            <CheckCircle2 size={13} /> {isGood ? "Ficou bom" : "Vai ajustar"}
          </span>
        )}
      </div>

      {excerpt.context && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "#a1a1aa",
            fontStyle: "italic",
            lineHeight: 1.5,
            padding: "8px 12px",
            background: "rgba(255,255,255,0.03)",
            borderLeft: "2px solid #3f3f46",
            borderRadius: 8,
          }}
        >
          {excerpt.context}
        </p>
      )}

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
              style={{ flex: 1, minHeight: 46, padding: "12px", borderRadius: 10, border: "none", background: "#a3e635", color: "#000", fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", transition: "opacity 160ms ease" }}
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
              style={{ minHeight: 46, padding: "12px 16px", borderRadius: 10, border: "1px solid #3f3f46", background: "transparent", color: "#a1a1aa", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => save({ rating: "good" })}
            disabled={saving}
            style={{
              flex: 1,
              minHeight: 46,
              padding: "12px",
              borderRadius: 10,
              border: isGood ? "none" : "1px solid #3f3f46",
              background: isGood ? "#a3e635" : "transparent",
              color: isGood ? "#000" : "#fafafa",
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "background 160ms ease, border-color 160ms ease",
            }}
          >
            👍 Ficou bom
          </button>
          <button
            onClick={() => setAdjusting(true)}
            disabled={saving}
            style={{
              flex: 1,
              minHeight: 46,
              padding: "12px",
              borderRadius: 10,
              border: isAdjust ? "none" : "1px solid #3f3f46",
              background: isAdjust ? "#a3e635" : "transparent",
              color: isAdjust ? "#000" : "#fafafa",
              fontSize: 15,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "background 160ms ease, border-color 160ms ease",
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
  const Icon = ROLE_ICON[message.role];
  const roleLabel = ROLE_LABEL[message.role];
  // wasAudio: prefixo 🎤 e sufixo "(enviada como áudio)" no rótulo (seção 6).
  const label = message.wasAudio ? `🎤 ${roleLabel} (enviada como áudio)` : roleLabel;
  const isLeft = style.align === "flex-start";

  return (
    <div style={{ display: "flex", justifyContent: style.align }}>
      <div style={{ maxWidth: "82%", display: "grid", gap: 4 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 700,
            color: ROLE_ICON_COLOR[message.role],
            justifyContent: isLeft ? "flex-start" : "flex-end",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          <Icon size={12} aria-hidden />
          {label}
        </span>
        <div
          style={{
            background: style.background,
            border: style.border,
            // Canto "achatado" do lado do remetente — imita o rabinho de bolha de chat real.
            borderRadius: isLeft ? "14px 14px 14px 4px" : "14px 14px 4px 14px",
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "#fafafa",
            whiteSpace: "pre-wrap",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}
