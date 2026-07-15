"use client";

/**
 * UI de curadoria da Revisão de Conversas (owner)
 * (docs/product/revisao-conversas-plano.md, seções 5 e 7).
 *
 * V1 do picker: lista de conversas elegíveis → expande mensagens → seleciona
 * intervalo contíguo (clique no início e no fim) → "Adicionar trecho". Sem
 * drag-and-drop; reordenar com ▲▼. Estilo visual dos arquivos irmãos
 * (setup-study-ui.tsx): inline styles + tokens var(--*).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Copy,
  Clock,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Plus,
  ThumbsUp,
  CheckCircle2,
  Mic,
} from "lucide-react";
import {
  addExcerpt,
  removeExcerpt,
  reorderExcerpt,
  updateExcerptContext,
  sendReviewForFeedback,
} from "../../conversation-review-actions";
import type {
  ConversationExcerpt,
  ConversationReviewStatus,
  ExcerptMessage,
  ExcerptRole,
} from "@/domain/entities/conversation-review";
import {
  MIN_EXCERPTS_PER_REVIEW,
  MAX_EXCERPTS_PER_REVIEW,
  MIN_MESSAGES_PER_EXCERPT,
  MAX_MESSAGES_PER_EXCERPT,
  MAX_EXCERPT_CONTEXT_CHARS,
} from "@/domain/entities/conversation-review";

// ── Tipos serializados vindos do server component ───────────────────────────

export interface PickerMessage {
  id: string;
  author: "lead" | "clinic_user" | "agent" | "system";
  body: string;
  mediaType: string | null;
  deliveryFormat: string | null;
  sentAt: string;
  simulated: boolean;
}

export interface PickerConversation {
  id: string;
  leadName: string | null;
  lastMessageAt: string | null;
  messages: PickerMessage[];
}

export interface ReviewViewModel {
  id: string;
  status: ConversationReviewStatus;
  title: string;
  excerpts: ConversationExcerpt[];
  overallComment: string | null;
  sentAt: string | null;
  answeredAt: string | null;
  expiresAt: string | null;
}

// ── Tela principal ──────────────────────────────────────────────────────────

export function ReviewWorkbench({
  clinicId,
  review,
  conversations,
}: {
  clinicId: string;
  review: ReviewViewModel;
  conversations: PickerConversation[];
}) {
  const isDraft = review.status === "draft";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {!isDraft && <StatusBanner review={review} />}

      {/* Trechos curados */}
      <section style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Trechos da rodada ({review.excerpts.length}/{MAX_EXCERPTS_PER_REVIEW})
          </h2>
          {isDraft && <SendControls clinicId={clinicId} review={review} />}
        </div>

        {review.excerpts.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            Nenhum trecho ainda. Escolha uma conversa abaixo e selecione as mensagens.
          </div>
        ) : (
          review.excerpts.map((excerpt, idx) => (
            <ExcerptRow
              key={excerpt.id}
              clinicId={clinicId}
              reviewId={review.id}
              excerpt={excerpt}
              index={idx}
              total={review.excerpts.length}
              editable={isDraft}
              showFeedback={review.status === "answered"}
            />
          ))
        )}
      </section>

      {/* Picker de conversas — só no rascunho */}
      {isDraft && (
        <ConversationPicker
          clinicId={clinicId}
          reviewId={review.id}
          conversations={conversations}
          excerptCount={review.excerpts.length}
        />
      )}
    </div>
  );
}

function StatusBanner({ review }: { review: ReviewViewModel }) {
  if (review.status === "answered") {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 10, background: "rgba(34,197,94,0.08)", fontSize: 13, color: "var(--text)" }}>
          <CheckCircle2 size={15} style={{ color: "#22c55e" }} />
          Respondida pelo cliente
          {review.answeredAt && ` em ${formatDate(review.answeredAt)}`}. Aplique no
          playbook/config o que fizer sentido.
        </div>
        {review.overallComment && (
          <div style={{ padding: "10px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 8, borderLeft: "2px solid #22c55e", fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#22c55e", marginBottom: 3 }}>
              Comentário geral do cliente
            </span>
            {review.overallComment}
          </div>
        )}
      </div>
    );
  }
  if (review.status === "sent") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 10, background: "rgba(245,158,11,0.08)", fontSize: 13, color: "var(--text)" }}>
        <Clock size={15} style={{ color: "#f59e0b" }} />
        Enviada{review.sentAt && ` em ${formatDate(review.sentAt)}`} — aguardando o cliente.
        {review.expiresAt && ` O link expira em ${formatDate(review.expiresAt)}.`}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 10, background: "var(--surface-soft)", fontSize: 13, color: "var(--muted)" }}>
      <Clock size={15} /> Rodada expirada — fica apenas como histórico.
    </div>
  );
}

// ── Envio (token exibido uma única vez) ─────────────────────────────────────

function SendControls({ clinicId, review }: { clinicId: string; review: ReviewViewModel }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canSend = review.excerpts.length >= MIN_EXCERPTS_PER_REVIEW;

  const handleSend = () => {
    if (!confirm("Enviar esta rodada para o cliente? Depois de enviada, os trechos não poderão mais ser editados.")) return;
    startTransition(async () => {
      try {
        const { url } = await sendReviewForFeedback(clinicId, review.id);
        setSentLink(url); // link exibido uma única vez
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao enviar a rodada.");
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

  if (sentLink) {
    return (
      <div style={{ display: "grid", gap: 8, width: "100%" }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
          Link criado. Copie e envie ao responsável pelo WhatsApp — <strong>este link só aparece agora</strong>.
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
    );
  }

  return (
    <button
      onClick={handleSend}
      disabled={isPending || !canSend}
      title={canSend ? "Gera o link e envia para o cliente revisar" : `Adicione ao menos ${MIN_EXCERPTS_PER_REVIEW} trechos`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 16px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#000",
        fontSize: 13, fontWeight: 700,
        cursor: isPending || !canSend ? "not-allowed" : "pointer",
        opacity: isPending || !canSend ? 0.6 : 1,
      }}
    >
      <Send size={14} /> {isPending ? "Enviando..." : "Enviar para o cliente"}
    </button>
  );
}

// ── Trecho curado ───────────────────────────────────────────────────────────

function ExcerptRow({
  clinicId,
  reviewId,
  excerpt,
  index,
  total,
  editable,
  showFeedback,
}: {
  clinicId: string;
  reviewId: string;
  excerpt: ConversationExcerpt;
  index: number;
  total: number;
  editable: boolean;
  showFeedback: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [draftContext, setDraftContext] = useState(excerpt.context ?? "");

  const run = (fn: () => Promise<void>, errorMsg: string) => {
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || errorMsg);
      }
    });
  };

  const handleSaveContext = () => {
    run(async () => {
      await updateExcerptContext(clinicId, reviewId, excerpt.id, draftContext);
      setIsEditingContext(false);
    }, "Erro ao salvar contexto.");
  };

  return (
    <div style={{ padding: "16px 20px", borderBottom: index === total - 1 ? "none" : "1px solid var(--line)", display: "grid", gap: 10, opacity: isPending ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", background: "var(--surface-soft)", padding: "2px 6px", borderRadius: 4 }}>
          Trecho {index + 1}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {excerpt.messages.length} mensagens
        </span>
        {editable && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button onClick={() => run(() => reorderExcerpt(clinicId, reviewId, excerpt.id, "up"), "Erro ao reordenar.")} disabled={isPending || index === 0} title="Mover para cima" style={{ ...curationBtnStyle, opacity: index === 0 ? 0.4 : 1 }}>
              <ArrowUp size={13} />
            </button>
            <button onClick={() => run(() => reorderExcerpt(clinicId, reviewId, excerpt.id, "down"), "Erro ao reordenar.")} disabled={isPending || index === total - 1} title="Mover para baixo" style={{ ...curationBtnStyle, opacity: index === total - 1 ? 0.4 : 1 }}>
              <ArrowDown size={13} />
            </button>
            {!isEditingContext && (
              <button onClick={() => setIsEditingContext(true)} disabled={isPending} title="Editar contexto" style={curationBtnStyle}>
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={() => {
                if (confirm("Remover este trecho?")) {
                  run(() => removeExcerpt(clinicId, reviewId, excerpt.id), "Erro ao remover trecho.");
                }
              }}
              disabled={isPending}
              title="Remover trecho"
              style={{ ...curationBtnStyle, color: "#ef4444" }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Linha de contexto do owner */}
      {isEditingContext && editable ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={draftContext}
            onChange={(e) => setDraftContext(e.target.value.slice(0, MAX_EXCERPT_CONTEXT_CHARS))}
            placeholder='Ex.: "Lead perguntou preço de lente"'
            autoFocus
            style={{ flex: 1, fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit" }}
          />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{draftContext.length}/{MAX_EXCERPT_CONTEXT_CHARS}</span>
          <button onClick={handleSaveContext} disabled={isPending} title="Salvar contexto" style={{ ...curationBtnStyle, color: "var(--accent)" }}>
            <Check size={13} />
          </button>
          <button onClick={() => { setDraftContext(excerpt.context ?? ""); setIsEditingContext(false); }} disabled={isPending} title="Cancelar" style={curationBtnStyle}>
            <X size={13} />
          </button>
        </div>
      ) : excerpt.context ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{excerpt.context}</p>
      ) : null}

      {/* Bolhas — colapsadas na curadoria, abertas na leitura */}
      {editable ? (
        <details>
          <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>Ver mensagens</summary>
          <div style={{ marginTop: 10 }}>
            <ExcerptBubbles messages={excerpt.messages} />
          </div>
        </details>
      ) : (
        <ExcerptBubbles messages={excerpt.messages} />
      )}

      {/* Feedback do cliente */}
      {showFeedback && (
        excerpt.feedback ? (
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: excerpt.feedback.rating === "good" ? "#22c55e" : "#f59e0b" }}>
              {excerpt.feedback.rating === "good" ? <ThumbsUp size={13} /> : <Pencil size={13} />}
              {excerpt.feedback.rating === "good" ? "Ficou bom" : "Eu ajustaria"}
            </span>
            {excerpt.feedback.comment && (
              <div style={{ padding: "8px 12px", background: "rgba(245,158,11,0.06)", borderRadius: 6, borderLeft: "2px solid #f59e0b", fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#f59e0b", marginBottom: 3 }}>
                  O que o cliente mudaria
                </span>
                {excerpt.feedback.comment}
              </div>
            )}
            {excerpt.feedback.suggestedReply && (
              <div style={{ padding: "8px 12px", background: "rgba(163,230,53,0.06)", borderRadius: 6, borderLeft: "2px solid var(--accent)", fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--accent)", marginBottom: 3 }}>
                  Como o cliente responderia
                </span>
                {excerpt.feedback.suggestedReply}
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Sem resposta do cliente neste trecho.</span>
        )
      )}
    </div>
  );
}

// ── Bolhas de chat (rótulos client-facing do Apêndice I) ────────────────────

const ROLE_LABELS: Record<ExcerptRole, string> = {
  lead: "Paciente",
  ia: "Assistente IA",
  clinica: "Equipe da clínica",
};

function ExcerptBubbles({ messages }: { messages: ExcerptMessage[] }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {messages.map((msg, i) => {
        const isLead = msg.role === "lead";
        return (
          <div key={i} style={{ display: "grid", gap: 3, justifyItems: isLead ? "start" : "end" }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              {msg.wasAudio && <Mic size={10} style={{ verticalAlign: "-1px", marginRight: 3 }} />}
              {ROLE_LABELS[msg.role]}
              {msg.wasAudio && " (enviada como áudio)"}
            </span>
            <div
              style={{
                maxWidth: "78%",
                padding: "8px 12px",
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                ...(msg.role === "lead"
                  ? { background: "var(--surface-soft)", border: "1px solid var(--line)" }
                  : msg.role === "ia"
                    ? { background: "rgba(163,230,53,0.10)", border: "1px solid rgba(163,230,53,0.30)" }
                    : { background: "transparent", border: "1px dashed var(--line)" }),
              }}
            >
              {msg.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Picker de conversas ─────────────────────────────────────────────────────

const PICKER_AUTHOR_LABELS: Record<PickerMessage["author"], string> = {
  lead: "Paciente",
  agent: "IA",
  clinic_user: "Equipe",
  system: "Sistema",
};

function ConversationPicker({
  clinicId,
  reviewId,
  conversations,
  excerptCount,
}: {
  clinicId: string;
  reviewId: string;
  conversations: PickerConversation[];
  excerptCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);
  const [context, setContext] = useState("");

  const reviewIsFull = excerptCount >= MAX_EXCERPTS_PER_REVIEW;

  const expanded = conversations.find((c) => c.id === expandedId) ?? null;

  /** Ids do intervalo contíguo entre anchor e end (inclusive), na conversa expandida. */
  const rangeIds = (() => {
    if (!expanded || !anchorId) return new Set<string>();
    const ids = expanded.messages.map((m) => m.id);
    const a = ids.indexOf(anchorId);
    const b = endId ? ids.indexOf(endId) : a;
    if (a === -1 || b === -1) return new Set<string>();
    const [start, end] = a <= b ? [a, b] : [b, a];
    return new Set(ids.slice(start, end + 1));
  })();

  const selectableCount = expanded
    ? expanded.messages.filter((m) => rangeIds.has(m.id) && m.author !== "system").length
    : 0;
  const canAdd =
    !reviewIsFull &&
    selectableCount >= MIN_MESSAGES_PER_EXCERPT &&
    selectableCount <= MAX_MESSAGES_PER_EXCERPT;

  const clearSelection = () => {
    setAnchorId(null);
    setEndId(null);
    setContext("");
  };

  const handleExpand = (convId: string) => {
    // Trocar de conversa (ou recolher a atual) descarta a seleção em
    // andamento — ela só é salva de fato ao clicar "Adicionar trecho".
    // Confirma antes de perder uma seleção não trivial silenciosamente.
    if (anchorId && expandedId && expandedId !== convId && selectableCount > 0) {
      const ok = window.confirm(
        `Você selecionou ${selectableCount} mensagem${selectableCount === 1 ? "" : "s"} nesta conversa e ainda não adicionou como trecho. Trocar de conversa agora descarta essa seleção. Continuar?`,
      );
      if (!ok) return;
    }
    setExpandedId((prev) => (prev === convId ? null : convId));
    clearSelection();
  };

  const handleSelect = (msgId: string) => {
    if (!anchorId) {
      setAnchorId(msgId);
      setEndId(msgId);
      return;
    }
    if (anchorId === msgId && endId === msgId) {
      clearSelection();
      return;
    }
    setEndId(msgId);
  };

  const handleAdd = () => {
    if (!expanded) return;
    const ids = expanded.messages.filter((m) => rangeIds.has(m.id)).map((m) => m.id);
    startTransition(async () => {
      try {
        await addExcerpt(clinicId, reviewId, expanded.id, ids, context || undefined);
        clearSelection();
        router.refresh();
      } catch (err: unknown) {
        alert((err as Error).message || "Erro ao adicionar trecho.");
      }
    });
  };

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Conversas do shadow (últimos 21 dias)</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Toque numa conversa, clique na primeira e na última mensagem do intervalo
          ({MIN_MESSAGES_PER_EXCERPT}–{MAX_MESSAGES_PER_EXCERPT} mensagens) e adicione como trecho.
          Os nomes e telefones são anonimizados automaticamente no trecho.
        </p>
      </div>

      {conversations.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          Nenhuma conversa com respostas da IA em shadow no período.
        </div>
      ) : (
        conversations.map((conv, idx) => {
          const isOpen = conv.id === expandedId;
          return (
            <div key={conv.id} style={{ borderBottom: idx === conversations.length - 1 ? "none" : "1px solid var(--line)" }}>
              <button
                onClick={() => handleExpand(conv.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", background: isOpen ? "var(--surface-soft)" : "transparent", border: "none", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
              >
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {conv.leadName ?? "Lead sem nome"}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{conv.messages.length} mensagens</span>
                {conv.lastMessageAt && (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{formatDate(conv.lastMessageAt)}</span>
                )}
              </button>

              {isOpen && (
                <div style={{ padding: "4px 20px 16px", display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    {conv.messages.map((msg) => {
                      const selected = rangeIds.has(msg.id);
                      const selectable = msg.author !== "system";
                      return (
                        <button
                          key={msg.id}
                          onClick={() => selectable && handleSelect(msg.id)}
                          disabled={!selectable || isPending}
                          title={selectable ? "Clique para marcar o início/fim do intervalo" : "Mensagens de sistema não entram no trecho"}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 8,
                            padding: "6px 10px", borderRadius: 8, textAlign: "left",
                            border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                            background: selected ? "rgba(163,230,53,0.08)" : "transparent",
                            color: selectable ? "var(--text)" : "var(--muted)",
                            fontSize: 13, cursor: selectable ? "pointer" : "default",
                            opacity: selectable ? 1 : 0.55,
                            width: "100%",
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: msg.author === "agent" ? "var(--accent)" : "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, paddingTop: 2 }}>
                            {PICKER_AUTHOR_LABELS[msg.author]}
                            {msg.author === "agent" && msg.simulated && " · shadow"}
                          </span>
                          {/* Mensagem completa, quebrando em múltiplas linhas — antes truncava
                              em nowrap sem que a elipse aparecesse (o contêiner vazava a
                              largura da tela em vez de encolher), tornando o texto ilegível. */}
                          <span style={{ flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "break-word", lineHeight: 1.45 }}>
                            {msg.mediaType ? `📎 [${msg.mediaType}] ` : ""}
                            {msg.deliveryFormat === "audio" ? "🎤 " : ""}
                            {msg.body}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0, paddingTop: 2 }}>
                            {new Date(msg.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Barra de adição */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: "var(--surface-soft)", border: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 12, color: selectableCount > MAX_MESSAGES_PER_EXCERPT ? "#ef4444" : "var(--muted)", fontWeight: 600 }}>
                      {selectableCount} selecionadas
                    </span>
                    <input
                      value={context}
                      onChange={(e) => setContext(e.target.value.slice(0, MAX_EXCERPT_CONTEXT_CHARS))}
                      placeholder="Contexto opcional (ex.: Lead perguntou preço de lente)"
                      style={{ flex: 1, minWidth: 200, fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit" }}
                    />
                    {anchorId && (
                      <button onClick={clearSelection} disabled={isPending} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
                        Limpar
                      </button>
                    )}
                    <button
                      onClick={handleAdd}
                      disabled={!canAdd || isPending}
                      title={
                        reviewIsFull
                          ? `A rodada já tem ${MAX_EXCERPTS_PER_REVIEW} trechos`
                          : canAdd
                            ? "Adicionar como trecho da rodada"
                            : `Selecione de ${MIN_MESSAGES_PER_EXCERPT} a ${MAX_MESSAGES_PER_EXCERPT} mensagens`
                      }
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "7px 14px", borderRadius: 8, border: "none",
                        background: "var(--accent)", color: "#000",
                        fontSize: 12, fontWeight: 700,
                        cursor: !canAdd || isPending ? "not-allowed" : "pointer",
                        opacity: !canAdd || isPending ? 0.6 : 1,
                      }}
                    >
                      <Plus size={13} /> {isPending ? "Adicionando..." : "Adicionar trecho"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <div style={{ padding: "10px 20px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
        <ChevronRight size={12} />
        O trecho é um retrato congelado e anonimizado — mudanças futuras na conversa não afetam a rodada.
      </div>
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
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
