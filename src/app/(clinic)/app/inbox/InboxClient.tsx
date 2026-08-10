"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { markNavigationStartInSession } from "@/application/observability/navigation-timing";
import { useRouter } from "next/navigation";
import {
  Search,
  Inbox,
  RefreshCw,
  Send,
  X,
  CalendarCheck,
  Tag,
  CheckCheck,
  Archive,
  MoreHorizontal,
  Trash2,
  MoveRight,
  Square,
  CheckSquare,
} from "lucide-react";
import type { ConversationCategory } from "@/domain/value-objects/conversation-category";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";
import { composeRecoveryMessageAction, sendRecoveryMessageAction } from "./recovery-actions";
import {
  setConversationCategory,
  setConversationCategoryBulk,
  deleteConversationsBulk,
  clearAttention,
} from "./[conversationId]/actions";
import { sortInboxRowsByRecency, type LiveInboxTabFilter } from "./inbox-filter";
import {
  resolveAppointmentLifecycleState,
  resolvePipelineIndex,
} from "./inbox-presentation";
import type { InboxTabKey } from "@/application/inbox/inbox-segmentation";
import type { InboxPageWindow } from "@/application/inbox/inbox-page-window";
import { buildInboxHref, type InboxNavigationTarget } from "./inbox-navigation";
import { isConversationUnreadByClinic } from "./inbox-visibility";
import { tempKey, tempLabel, avatarColor, relativeTime, conversationCategoryLabel } from "./inbox-utils";
import { LeadAvatar } from "./[conversationId]/LeadAvatar";
import { EnableNotificationsButton } from "@/components/enable-notifications-button";
import { avatarInitial } from "./avatar-initial";
import { pendingActionLabel, type InboxPendingAction } from "./inbox-pending";

export type ConvRow = {
  convId: string;
  leadId: string;
  lastMessageAt: Date | null;
  latestMessageAt?: Date | null;
  lastReadAt: Date | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
  conversationCategory: ConversationCategory;
  takeoverExpiresAt?: Date | null;
  leadName: string | null;
  leadPhone: string | null;
  leadStatus: string;
  leadTemperature: string | null;
  leadTreatmentInterest: string | null;
  leadProfilePicUrl: string | null;
  appointmentStartsAt?: Date | null;
  latestAppointmentStatus?: "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show" | null;
  latestAppointmentUpdatedAt?: Date | null;
  hoursWaiting?: number;
  pendingAction: InboxPendingAction | null;
};

const PIPELINE_STEPS = ["Novo", "Qualific.", "Proposta", "Agendar", "Fechado"] as const;
type InboxCategoryScope = ConversationCategory;

const MOVE_OPTIONS: { key: ConversationCategory; label: string }[] = [
  { key: "sales", label: "Comercial" },
  { key: "operational", label: "Operacional" },
  { key: "vendor", label: "Fornecedores" },
  { key: "spam", label: "Spam" },
  { key: "archived", label: "Arquivadas" },
];

function CategoryMoveButton({
  convId,
  currentCategory,
}: {
  convId: string;
  currentCategory: ConversationCategory;
}) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const options = currentCategory === "archived"
    ? MOVE_OPTIONS.filter((option) => option.key !== "archived")
    : [
        MOVE_OPTIONS.find((option) => option.key === "archived")!,
        ...MOVE_OPTIONS.filter((option) => option.key !== currentCategory && option.key !== "archived"),
      ];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function optionLabel(option: ConversationCategory): string {
    if (currentCategory !== "archived" && option === "archived") return "Arquivar conversa";
    if (currentCategory === "archived" && option === "sales") return "Desarquivar para Comercial";
    return `Mover para ${conversationCategoryLabel(option)}`;
  }

  return (
    <div className="category-move" ref={menuRef}>
      <button
        title="Mover para..."
        aria-label="Mover conversa"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`category-move-trigger${open ? " active" : ""}`}
        disabled={isPending}
      >
        <Tag size={13} />
      </button>
      {open && (
        <div className="category-move-menu" role="menu">
          {options.map((option) => (
            <button
              key={option.key}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                startTransition(async () => {
                  await setConversationCategory(convId, option.key);
                  router.refresh();
                });
              }}
              className={`category-move-item${option.key === "archived" || currentCategory === "archived" && option.key === "sales" ? " primary" : ""}`}
              role="menuitem"
            >
              {option.key === "archived" ? <Archive size={13} /> : <Tag size={13} />}
              <span>{optionLabel(option.key)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatWaitTime(hours: number): string {
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function RecoveryModal({
  row,
  lastMsg,
  onClose,
}: {
  row: ConvRow;
  lastMsg: { body: string; author: string; sentAt?: Date | null };
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [engineRecovering, setEngineRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [, startTransition] = useTransition();
  const retryOperationIdRef = useRef<string | null>(null);

  const displayName = row.leadName ?? row.leadPhone ?? "Lead";

  // J1: retomada pelo próprio motor — a IA reprocessa a última mensagem do lead
  // com persona, pipeline e ritmo do fluxo orgânico (uma persona só).
  async function handleEngineRecover() {
    if (engineRecovering) return;
    setEngineRecovering(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${row.convId}/recover`, { method: "POST" });
      const data: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Não foi possível retomar pelo motor.");
        return;
      }
      setSent(true);
      setTimeout(onClose, 1200);
    } catch {
      setError("Falha na conexão ao retomar pelo motor.");
    } finally {
      setEngineRecovering(false);
    }
  }

  function handleGenerate() {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const result = await composeRecoveryMessageAction(row.convId);
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        setMessage(result.message ?? "");
        retryOperationIdRef.current = null;
      }
    });
  }

  function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    startTransition(async () => {
      const result = await sendRecoveryMessageAction(
        row.convId,
        message.trim(),
        retryOperationIdRef.current ??= crypto.randomUUID(),
      );
      setSending(false);
      if (result.error) {
        setError(result.error);
      } else {
        setSent(true);
        setTimeout(onClose, 1200);
      }
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 480,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
              Retomada — {displayName}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Esperando há {formatWaitTime(row.hoursWaiting ?? 0)} · última msg: &ldquo;{lastMsg.body.slice(0, 60)}{lastMsg.body.length > 60 ? "…" : ""}&rdquo;
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)" }}
          >
            <X size={18} />
          </button>
        </div>

        {!message && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => void handleEngineRecover()}
              disabled={engineRecovering}
              className="primary-button"
              style={{
                borderRadius: 8,
                padding: "10px 16px",
                cursor: engineRecovering ? "wait" : "pointer",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              title="A IA responde a última mensagem do lead com a persona e o fluxo completos"
            >
              <RefreshCw size={14} />
              {engineRecovering ? "Retomando…" : "Retomar com a IA agora"}
            </button>
            <button
              onClick={handleGenerate}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 16px",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              ou escrever mensagem manual com IA
            </button>
          </div>
        )}

        {loading && (
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>
            Gerando mensagem…
          </div>
        )}

        {message && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              MENSAGEM (edite se necessário)
            </label>
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                retryOperationIdRef.current = null;
              }}
              rows={4}
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "var(--text)",
                fontSize: 14,
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={handleGenerate}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: 0,
                alignSelf: "flex-start",
              }}
            >
              <RefreshCw size={12} />
              Gerar novamente
            </button>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "#ef4444", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
            {error}
          </div>
        )}

        {sent && (
          <div style={{ fontSize: 13, color: "#10b981", textAlign: "center", fontWeight: 600 }}>
            Mensagem enviada ✓
          </div>
        )}

        {message && !sent && (
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            style={{
              background: "#059669",
              border: "none",
              borderRadius: 8,
              padding: "11px 16px",
              cursor: sending ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: sending ? 0.6 : 1,
            }}
          >
            <Send size={14} />
            {sending ? "Enviando…" : "Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}

function RecoveryCard({
  row,
  lastMsg,
  selectionMode,
  selected,
  onToggleSelected,
}: {
  row: ConvRow;
  lastMsg: { body: string; author: string; sentAt?: Date | null };
  selectionMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const accentColor = avatarColor(row.leadTemperature);
  const initial = avatarInitial(displayName);
  const hours = row.hoursWaiting ?? 0;
  const waitLabel = formatWaitTime(hours);
  const reason = row.aiPaused ? "Takeover expirado" : `Sem resposta há ${waitLabel}`;

  return (
    <>
      {modalOpen && (
        <RecoveryModal
          row={row}
          lastMsg={lastMsg}
          onClose={() => setModalOpen(false)}
        />
      )}
      <div
        className={`inbox-card-v2${selectionMode ? " selection-mode" : ""}${selected ? " selected" : ""}`}
        style={{ borderLeft: "3px solid #f59e0b" }}
      >
        {selectionMode && (
          <button
            type="button"
            className="inbox-select-check"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelected();
            }}
            aria-label={selected ? "Remover conversa da seleção" : "Selecionar conversa"}
          >
            {selected ? <CheckSquare size={17} /> : <Square size={17} />}
          </button>
        )}
        <Link
          href={`/app/inbox/${row.convId}`}
          style={{ textDecoration: "none", display: "block" }}
          onClick={(e) => {
            if (selectionMode) {
              e.preventDefault();
              onToggleSelected();
              return;
            }
            markNavigationStartInSession(`/app/inbox/${row.convId}`);
          }}
        >
          <div className="inbox-card-v2-top">
            <span style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b" }}>{reason}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {row.latestMessageAt
                  ? relativeTime(new Date(row.latestMessageAt))
                  : row.lastMessageAt
                    ? relativeTime(new Date(row.lastMessageAt))
                    : "—"}
              </span>
              <CategoryMoveButton convId={row.convId} currentCategory={row.conversationCategory} />
            </div>
          </div>

          <div className="inbox-card-v2-body">
            <LeadAvatar
              profilePicUrl={row.leadProfilePicUrl}
              displayName={displayName}
              initial={initial}
              accentColor={accentColor}
              className="avatar-v2"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {displayName}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {lastMsg.body ? `"${lastMsg.body.slice(0, 48)}${lastMsg.body.length > 48 ? "…" : ""}"` : "Sem mensagens"}
              </div>
            </div>
          </div>
        </Link>

        {!selectionMode && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Link
            href={`/app/inbox/${row.convId}`}
            onClick={() => markNavigationStartInSession(`/app/inbox/${row.convId}`)}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "7px 0",
              background: "var(--surface-raised)",
              border: "1px solid var(--line)",
              borderRadius: 7,
              fontSize: 12,
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            Ver conversa
          </Link>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              flex: 1,
              padding: "7px 0",
              background: "#059669",
              border: "none",
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Send size={12} />
            Enviar retomada
          </button>
        </div>
        )}
      </div>
    </>
  );
}

type LastInboxMessage = { body: string; author: string; sentAt?: Date | null; simulated?: boolean };

function cardBorderClass(row: ConvRow, lastMsg: LastInboxMessage, autoReplyEnabled: boolean): string {
  if (row.needsAttention) return "card-border-attention";
  if (!isSalesConversationCategory(row.conversationCategory)) return "card-border-default";
  const appointmentState = resolveAppointmentLifecycleState(row);
  if (appointmentState === "no_show") return "card-border-attention";
  if (appointmentState === "cancelled") return "card-border-paused";
  if (appointmentState === "scheduled" || appointmentState === "confirmed") return "card-border-scheduled";
  if (row.aiPaused) return "card-border-paused";
  if (lastMsg.author === "agent") {
    // IA desligada para a clínica inteira: a última resposta veio do operador
    // (ou é histórica), então não pinte o card como "IA ativa".
    if (!autoReplyEnabled || lastMsg.simulated) return "card-border-paused";
    return "card-border-ai-active";
  }
  return "card-border-default";
}

function formatApptDate(date: Date): string {
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function convStatusBadge(
  row: ConvRow,
  lastMsg: LastInboxMessage,
  autoReplyEnabled: boolean,
): { label: string; variant: "hot" | "warm" | "accent" | "muted" } {
  if (!isSalesConversationCategory(row.conversationCategory)) {
    return { label: conversationCategoryLabel(row.conversationCategory), variant: "muted" };
  }
  if (row.pendingAction) {
    return {
      label: pendingActionLabel(row.pendingAction),
      variant: row.pendingAction === "deposit_proof" ? "warm" : "hot",
    };
  }
  const appointmentState = resolveAppointmentLifecycleState(row);
  if (row.needsAttention) return { label: "Requer humano", variant: "hot" };
  if (appointmentState === "confirmed") return { label: "Consulta confirmada", variant: "accent" };
  if (appointmentState === "scheduled") return { label: "Consulta marcada", variant: "accent" };
  if (appointmentState === "completed") return { label: "Atendido", variant: "accent" };
  if (appointmentState === "cancelled") return { label: "Cancelou", variant: "muted" };
  if (appointmentState === "no_show") return { label: "Não compareceu", variant: "hot" };
  if (row.leadStatus === "follow_up_due") return { label: "Em recuperação", variant: "warm" };
  if (row.aiPaused) return { label: "Aguardando retorno", variant: "warm" };
  if (lastMsg.author === "agent") {
    // Com a IA desligada para a clínica, o card não pode anunciar "IA respondendo".
    if (!autoReplyEnabled) return { label: "IA pausada", variant: "muted" };
    if (lastMsg.simulated) return { label: "IA simulando", variant: "warm" };
    return { label: "IA respondendo", variant: "accent" };
  }
  if (lastMsg.author === "lead") return { label: "Aguardando resposta", variant: "warm" };
  return { label: "Em conversa", variant: "muted" };
}

function markConversationRead(conversationId: string): void {
  void fetch(`/api/conversations/${conversationId}/read`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}

function InboxCard({
  row,
  lastMsg,
  autoReplyEnabled,
  selectionMode,
  selected,
  onToggleSelected,
}: {
  row: ConvRow;
  lastMsg: LastInboxMessage;
  autoReplyEnabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const displayName = row.leadName ?? row.leadPhone ?? "Lead";
  const initial = avatarInitial(displayName);
  const tk = tempKey(row.leadTemperature);
  const { label: tLabel } = tempLabel(row.leadTemperature);
  const isSalesRow = isSalesConversationCategory(row.conversationCategory);
  const hasUnread = isConversationUnreadByClinic({
    lastAuthor: lastMsg.author,
    lastMessageAt: row.lastMessageAt,
    lastReadAt: row.lastReadAt,
  });
  const pipeStep = resolvePipelineIndex(row);
  const badge = convStatusBadge(row, lastMsg, autoReplyEnabled);
  const borderClass = cardBorderClass(row, lastMsg, autoReplyEnabled);
  const treatment =
    row.leadTreatmentInterest && row.leadTreatmentInterest.length > 28
      ? row.leadTreatmentInterest.slice(0, 26) + "…"
      : row.leadTreatmentInterest;
  const accentColor = avatarColor(row.leadTemperature);

  return (
    <Link
      href={`/app/inbox/${row.convId}`}
      onClick={(e) => {
        if (selectionMode) {
          e.preventDefault();
          onToggleSelected();
          return;
        }
        markNavigationStartInSession(`/app/inbox/${row.convId}`);
        markConversationRead(row.convId);
      }}
      style={{ textDecoration: "none" }}
    >
      <div
        className={`inbox-card-v2 ${borderClass}${hasUnread ? " has-unread" : ""}${selectionMode ? " selection-mode" : ""}${selected ? " selected" : ""}`}
      >
        {selectionMode && (
          <button
            type="button"
            className="inbox-select-check"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelected();
            }}
            aria-label={selected ? "Remover conversa da seleção" : "Selecionar conversa"}
          >
            {selected ? <CheckSquare size={17} /> : <Square size={17} />}
          </button>
        )}
        <div className="inbox-card-v2-top">
          {row.pendingAction ? (
            <span className="temp-badge-v2 temp-badge-v2-attention">
              {pendingActionLabel(row.pendingAction)}
            </span>
          ) : row.needsAttention ? (
            <span className="temp-badge-v2 temp-badge-v2-attention">Atenção</span>
          ) : (
            <span className={`temp-badge-v2 temp-badge-v2-${tk}`}>{tLabel}</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CategoryMoveButton convId={row.convId} currentCategory={row.conversationCategory} />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {row.latestMessageAt
                ? relativeTime(new Date(row.latestMessageAt))
                : row.lastMessageAt
                  ? relativeTime(new Date(row.lastMessageAt))
                  : "—"}
            </span>
            {hasUnread && <span className="unread-dot-v2" />}
          </div>
        </div>

        <div className="inbox-card-v2-body">
          <LeadAvatar
            profilePicUrl={row.leadProfilePicUrl}
            displayName={displayName}
            initial={initial}
            accentColor={accentColor}
            className="avatar-v2"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            {!isSalesRow && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--accent-strong)",
                  marginTop: 3,
                  fontWeight: 600,
                }}
              >
                {conversationCategoryLabel(row.conversationCategory)}
              </div>
            )}
            {treatment && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {treatment}
              </div>
            )}
          </div>
        </div>

        {isSalesRow && (
          <div className="pipeline-v2">
            {PIPELINE_STEPS.map((step, i) => {
              const isDone = i < pipeStep;
              const isActive = i === pipeStep;
              return (
                <div
                  key={step}
                  className={`pipeline-v2-step${isActive ? " active" : isDone ? " done" : ""}`}
                  style={
                    isActive
                      ? ({ "--step-color": accentColor } as React.CSSProperties)
                      : undefined
                  }
                >
                  <div className="pipeline-v2-dot" />
                  <span className="pipeline-v2-label">{step}</span>
                </div>
              );
            })}
          </div>
        )}

        {isSalesRow && row.appointmentStartsAt && (
          <div className="appointment-date-chip">
            <CalendarCheck size={10} />
            <span>Consulta: {formatApptDate(new Date(row.appointmentStartsAt))}</span>
          </div>
        )}

        <div className="inbox-card-v2-footer">
          <span className="inbox-card-v2-preview">
            {lastMsg.body ? lastMsg.body.slice(0, 52) : "Sem mensagens"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {row.needsAttention && !row.pendingAction && <AttendedButton convId={row.convId} />}
            <span className={`status-badge-v2 status-badge-v2-${badge.variant}`}>
              {badge.label}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function AttendedButton({ convId }: { convId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => { await clearAttention(convId); });
      }}
      disabled={isPending}
      title="Marcar como atendido"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
        background: "rgba(16,185,129,0.12)", color: "var(--accent-strong)",
        border: "1px solid rgba(16,185,129,0.3)", cursor: "pointer", opacity: isPending ? 0.6 : 1,
      }}
    >
      <CheckCheck size={11} />
      {isPending ? "Salvando…" : "Atendido"}
    </button>
  );
}

// Rodapé de continuação. A troca de página é uma NAVEGAÇÃO de servidor, igual
// à troca de aba: é page.tsx que decide quais ids valem a leitura cara, então
// cada passo busca no máximo INBOX_PAGE_SIZE conversas — a lista não acumula
// no cliente. Por isso o rótulo diz "mais antigas" e vem acompanhado do
// intervalo exibido, em vez de fingir scroll infinito.
function InboxContinuation({
  window: pageWindow,
  pending,
  onGoToPage,
}: {
  window: InboxPageWindow;
  pending: boolean;
  onGoToPage: (page: number) => void;
}) {
  if (!pageWindow.hasMore && !pageWindow.hasPrevious) return null;

  const buttonStyle: React.CSSProperties = {
    background: "var(--surface-raised)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    color: "var(--text)",
    cursor: pending ? "wait" : "pointer",
    opacity: pending ? 0.6 : 1,
  };

  return (
    <div
      className="inbox-continuation"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "18px 0 8px",
      }}
    >
      {pageWindow.hasPrevious && (
        <button type="button" style={buttonStyle} disabled={pending} onClick={() => onGoToPage(pageWindow.page - 1)}>
          Mais recentes
        </button>
      )}
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        {pageWindow.firstIndex}–{pageWindow.lastIndex} de {pageWindow.totalIds}
      </span>
      {pageWindow.hasMore && (
        <button type="button" style={buttonStyle} disabled={pending} onClick={() => onGoToPage(pageWindow.page + 1)}>
          Carregar mais antigas
        </button>
      )}
    </div>
  );
}

// Contagens/membership por aba e por escopo: hoje decididas pelo índice de
// segmentação do servidor (src/application/inbox/inbox-segmentation.ts), não
// mais recalculadas aqui em cima de `rows` — `rows` é só a página (até
// INBOX_PAGE_SIZE) da aba/escopo ativos, não a clínica inteira.
export type InboxTabCounts = {
  tabs: Record<InboxTabKey, number>;
  scopes: Record<ConversationCategory, number>;
  // Cabeçalho "N conversas ativas" (handoff + active, pausadas não contam).
  activeCount: number;
  // Decide só o empty state ("nenhuma conversa ainda"), não a membership de nenhuma aba.
  totalConversations: number;
};

export function InboxClient({
  rows,
  lastMsgMap,
  autoReplyEnabled,
  counts,
  initialScope = "sales",
  initialTab = "all",
  initialSearch = "",
  pageWindow,
}: {
  rows: ConvRow[];
  lastMsgMap: Record<string, LastInboxMessage>;
  autoReplyEnabled: boolean;
  counts: InboxTabCounts;
  initialScope?: InboxCategoryScope;
  initialTab?: LiveInboxTabFilter | "recovery";
  initialSearch?: string;
  // Janela da lista da aba ativa. Decidida no servidor (page.tsx), porque é o
  // servidor que escolhe quais ids valem a leitura cara — aqui só se
  // renderiza o rodapé a partir dela.
  pageWindow: InboxPageWindow;
}) {
  const router = useRouter();
  // Aba/escopo ativos NÃO são mais estado local: vêm de page.tsx, que já leu
  // os search params e buscou a página bounded certa para eles. Se virassem
  // useState de novo, clicar numa aba mudaria o rótulo ativo mas `rows`
  // continuaria sendo a página da aba anterior — exatamente o bug que essa
  // task existe pra fechar.
  const scope = initialScope;
  const tab = initialTab;
  // `search` É estado local, mas só pra digitação instantânea no campo — o
  // texto que decide QUAIS conversas aparecem é sempre `initialSearch`
  // (o que o servidor já filtrou). Ver o useEffect de debounce abaixo.
  const [search, setSearch] = useState(initialSearch);
  const [isTabPending, startTabTransition] = useTransition();
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [isBulkPending, startBulkTransition] = useTransition();
  const topMenuRef = useRef<HTMLDivElement>(null);
  const bulkMoveRef = useRef<HTMLDivElement>(null);
  // Debounce da busca pode estar esperando pra navegar quando um clique de
  // aba navega primeiro; sem cancelar o timer, o debounce dispara depois com
  // o fechamento antigo de scope/tab e desfaz o clique. goToInbox cancela
  // qualquer debounce pendente antes de navegar por qualquer motivo.
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Troca de aba/escopo/busca navega para uma nova URL em vez de só trocar
  // estado local: page.tsx roda de novo no servidor e busca a página bounded
  // certa (a leitura cara é limitada a INBOX_PAGE_SIZE da aba+busca ativas,
  // não dá mais pra ter todas as abas pré-carregadas no cliente, e a busca
  // precisa valer pra clínica inteira, não só pra página já carregada).
  function goToInbox(overrides: Partial<InboxNavigationTarget>) {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    // `page: 1` na base, não `pageWindow.page`: trocar de aba, de escopo ou de
    // busca precisa VOLTAR para a primeira página, senão o operador clica em
    // "Atenção" estando na página 3 e cai numa aba que parece vazia. Só o
    // rodapé de continuação passa `page` explicitamente.
    const target: InboxNavigationTarget = { scope, tab, search, page: 1, ...overrides };
    startTabTransition(() => {
      router.push(buildInboxHref(target));
    });
  }

  // Debounce: cada tecla atualiza o campo na hora (estado local), mas só
  // navega — e só então re-executa a busca clinic-wide no servidor — depois
  // de 350ms sem digitar. Sem isso, cada tecla dispararia uma varredura
  // completa da clínica.
  useEffect(() => {
    if (search === initialSearch) return;
    searchDebounceRef.current = setTimeout(() => {
      goToInbox({ search });
    }, 350);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!topMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (topMenuRef.current && !topMenuRef.current.contains(e.target as Node)) {
        setTopMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [topMenuOpen]);

  useEffect(() => {
    if (!bulkMoveOpen) return;
    function handleClick(e: MouseEvent) {
      if (bulkMoveRef.current && !bulkMoveRef.current.contains(e.target as Node)) {
        setBulkMoveOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bulkMoveOpen]);

  if (counts.totalConversations === 0) {
    return (
      <div className="inbox-content inbox-empty-content">
        <div className="empty-state inbox-empty-state">
          <Inbox
            size={32}
            style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }}
          />
          <p style={{ margin: 0 }}>Nenhuma conversa ainda.</p>
          <p style={{ margin: "4px 0 0", fontSize: 12 }}>
            Assim que um lead enviar mensagem via WhatsApp, ela aparecerá aqui.
          </p>
        </div>
      </div>
    );
  }

  const TABS: { key: LiveInboxTabFilter | "recovery"; label: string; count: number }[] = [
    { key: "all",       label: "Todas",       count: counts.tabs.all },
    { key: "hot",       label: "Quentes",     count: counts.tabs.hot },
    { key: "attention", label: "Atenção",     count: counts.tabs.attention },
    { key: "pending",   label: "Pendências",  count: counts.tabs.pending },
    { key: "paused",    label: "Pausados",    count: counts.tabs.paused },
    { key: "cold",      label: "Resfriadas",  count: counts.tabs.cold },
    { key: "recovery",  label: "Recuperação", count: counts.tabs.recovery },
  ];

  const isSalesScope = scope === "sales";
  const isArchivedScope = scope === "archived";
  const isRecoveryTab = isSalesScope && tab === "recovery";
  // `rows` já chega do servidor como a página (até INBOX_PAGE_SIZE) da
  // aba/escopo/busca ativos — a busca em si é feita pelo servidor sobre a
  // clínica inteira (Fix round 1 — Critical #1), não sobra filtro de busca
  // pra fazer aqui. sortInboxRowsByRecency só reafirma a ordem do servidor
  // (não filtra nada), útil se `rows` chegar fora de ordem por qualquer motivo.
  const sortedAll = sortInboxRowsByRecency(rows);
  const sortedRows = isRecoveryTab ? [] : sortedAll;
  const sortedRecovery = isRecoveryTab ? sortedAll : [];
  const scopeLabel = conversationCategoryLabel(scope).toLowerCase();
  const selectedCount = selectedIds.size;
  const selectedIdList = [...selectedIds];

  function toggleSelected(conversationId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  }

  function enterSelectionMode() {
    setTopMenuOpen(false);
    setSelectionMode(true);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkMoveOpen(false);
  }

  function handleBulkMove(category: ConversationCategory) {
    if (selectedCount === 0) return;
    setBulkMoveOpen(false);
    startBulkTransition(async () => {
      await setConversationCategoryBulk(selectedIdList, category);
      exitSelectionMode();
      router.refresh();
    });
  }

  function handleBulkDelete() {
    if (selectedCount === 0) return;
    const confirmed = window.confirm(
      `Excluir ${selectedCount} conversa${selectedCount !== 1 ? "s" : ""}? Esta ação remove o histórico da operação.`,
    );
    if (!confirmed) return;
    startBulkTransition(async () => {
      await deleteConversationsBulk(selectedIdList);
      exitSelectionMode();
      router.refresh();
    });
  }

  return (
    <>
      <div className="inbox-topbar">
        <div className="inbox-title-area">
          <div className="inbox-more-wrap" ref={topMenuRef}>
            <button
              type="button"
              className="inbox-more-button"
              onClick={() => setTopMenuOpen((open) => !open)}
              aria-label="Mais opções do inbox"
              aria-haspopup="menu"
              aria-expanded={topMenuOpen}
            >
              <MoreHorizontal size={17} />
            </button>
            {topMenuOpen && (
              <div className="inbox-top-menu" role="menu">
                <button type="button" onClick={enterSelectionMode} role="menuitem">
                  <CheckSquare size={14} />
                  Selecionar conversas
                </button>
              </div>
            )}
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Inbox IA
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
            <span className="live-dot" style={{ width: 6, height: 6, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {counts.activeCount} conversa{counts.activeCount !== 1 ? "s" : ""} ativa{counts.activeCount !== 1 ? "s" : ""}
            </span>
            {autoReplyEnabled && (
              <span className="ia-active-badge" style={{ fontSize: 10, padding: "2px 8px" }}>
                IA Ativa
              </span>
            )}
          </div>
        </div>
        <EnableNotificationsButton />
      </div>

      {selectionMode && (
        <div className="inbox-selection-bar">
          <span>
            {selectedCount === 0
              ? "Selecione conversas"
              : `${selectedCount} selecionada${selectedCount !== 1 ? "s" : ""}`}
          </span>
          <div className="inbox-selection-actions">
            <button
              type="button"
              onClick={() => handleBulkMove("archived")}
              disabled={selectedCount === 0 || isBulkPending}
            >
              <Archive size={14} />
              Arquivar
            </button>
            <div className="inbox-bulk-move" ref={bulkMoveRef}>
              <button
                type="button"
                onClick={() => setBulkMoveOpen((open) => !open)}
                disabled={selectedCount === 0 || isBulkPending}
                aria-haspopup="menu"
                aria-expanded={bulkMoveOpen}
              >
                <MoveRight size={14} />
                Mover
              </button>
              {bulkMoveOpen && (
                <div className="inbox-bulk-menu" role="menu">
                  {MOVE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => handleBulkMove(option.key)}
                      role="menuitem"
                    >
                      {conversationCategoryLabel(option.key)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="danger"
              onClick={handleBulkDelete}
              disabled={selectedCount === 0 || isBulkPending}
            >
              <Trash2 size={14} />
              Excluir
            </button>
            <button type="button" className="ghost" onClick={exitSelectionMode} disabled={isBulkPending}>
              <X size={14} />
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="inbox-tabs-bar inbox-primary-tabs" style={{ opacity: isTabPending ? 0.6 : 1 }}>
        {TABS.map(({ key, label, count }) => (
          <button
            key={key}
            className={`inbox-tab-pill${isSalesScope && tab === key ? " active" : ""}`}
            onClick={() => goToInbox({ scope: "sales", tab: key })}
          >
            {label}
            {count > 0 && (
              <span className={`inbox-tab-count${isSalesScope && tab === key ? " active" : ""}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="inbox-archive-tabs" style={{ opacity: isTabPending ? 0.6 : 1 }}>
        <button
          className={`inbox-tab-pill inbox-archive-tab${isArchivedScope ? " active" : ""}`}
          onClick={() => goToInbox({ scope: "archived", tab: "all" })}
        >
          <Archive size={12} />
          Arquivados
          {counts.scopes.archived > 0 && (
            <span className={`inbox-tab-count${isArchivedScope ? " active" : ""}`}>
              {counts.scopes.archived}
            </span>
          )}
        </button>
        {scope !== "sales" && scope !== "archived" && (
          <button
            className="inbox-tab-pill inbox-archive-tab active"
            onClick={() => goToInbox({ scope, tab: "all" })}
          >
            {conversationCategoryLabel(scope)}
            <span className="inbox-tab-count active">
              {counts.scopes[scope]}
            </span>
          </button>
        )}
      </div>

      <div className="inbox-search-bar" style={{ opacity: isTabPending ? 0.6 : 1 }}>
        <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Nome, telefone ou tratamento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="inbox-search-input"
        />
      </div>

      <div className="inbox-content">
        {isRecoveryTab ? (
          sortedRecovery.length === 0 ? (
            <div className="empty-state">
              <RefreshCw
                size={28}
                style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }}
              />
              <p style={{ margin: 0 }}>Nenhum lead precisa de recuperação.</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                Leads sem resposta há 2h+ ou com takeover expirado aparecem aqui.
              </p>
            </div>
          ) : (
            <div className="conversation-grid">
              {sortedRecovery.map((row) => (
                <RecoveryCard
                  key={row.convId}
                  row={row}
                  lastMsg={lastMsgMap[row.convId] ?? { body: "", author: "", sentAt: null, simulated: false }}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(row.convId)}
                  onToggleSelected={() => toggleSelected(row.convId)}
                />
              ))}
            </div>
          )
        ) : sortedRows.length === 0 ? (
          <div className="empty-state">
            <Search
              size={28}
              style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }}
            />
            <p style={{ margin: 0 }}>
              {isArchivedScope ? "Nenhuma conversa arquivada." : isSalesScope ? "Nenhuma conversa encontrada." : `Nenhuma conversa em ${scopeLabel}.`}
            </p>
          </div>
        ) : (
          <div className="conversation-grid">
            {sortedRows.map((row) => (
              <InboxCard
                key={row.convId}
                row={row}
                lastMsg={lastMsgMap[row.convId] ?? { body: "", author: "", sentAt: null, simulated: false }}
                autoReplyEnabled={autoReplyEnabled}
                selectionMode={selectionMode}
                selected={selectedIds.has(row.convId)}
                onToggleSelected={() => toggleSelected(row.convId)}
              />
            ))}
          </div>
        )}

        <InboxContinuation
          window={pageWindow}
          pending={isTabPending}
          onGoToPage={(page) => goToInbox({ page })}
        />
      </div>
    </>
  );
}
