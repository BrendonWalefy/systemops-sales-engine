"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Calendar, Send, AlertCircle, CalendarPlus, Tag, Clock, UserRoundCog, ListChecks, Paperclip, X, FileText, Film, Image as ImageIcon, Loader2 } from "lucide-react";
import { isSalesConversationCategory } from "@/domain/value-objects/conversation-category";
import { DurationHoursInput } from "@/components/DurationHoursInput";
import { formatAttachmentSize, inspectOperatorAttachment, OPERATOR_ATTACHMENT_ACCEPT } from "@/application/conversations/operator-attachment";
import { upload } from "@vercel/blob/client";

interface Props {
  conversationId: string;
  aiPaused: boolean;
  leadName: string | null;
  treatmentInterest: string | null;
  temperature: string | null;
  leadStatus: string | null;
  conversationCategory: string;
  needsAttention: boolean;
  attentionReason: string | null;
  defaultDurationMinutes: number;
  timezone: string;
}

function deriveNextAction(params: {
  temperature: string | null;
  status: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  aiPaused: boolean;
}): string | null {
  if (params.needsAttention) return params.attentionReason ?? "Lead pediu atendimento humano";
  if (!params.aiPaused) return null;
  if (params.temperature === "hot") {
    if (params.status === "qualified" || params.status === "proposal_sent") return "Confirmar proposta ou fechar agendamento";
    return "Avançar para proposta — lead está quente";
  }
  if (params.temperature === "warm") {
    return "Enviar casos reais para reforçar valor";
  }
  return "Qualificar interesse e identificar tratamento";
}

const DISCOUNT_PRESETS = [200, 300, 500] as const;

// A ação coloca a conversa no trilho do pipeline: a IA responde a última
// mensagem do lead e conduz os próximos passos conforme as respostas dele
// (nada é despejado de uma vez — o resumo abaixo é prévia do trilho completo).
type PipelineOption = {
  treatmentId: string;
  treatmentName: string;
  summary: {
    action: "start_pipeline_rails";
    label: string;
    textParts: number;
    mediaParts: number;
    preview: string | null;
    willWaitForPhoto: boolean;
  };
  sections: PipelineSection[];
};

type PipelineSection = {
  stepIndex: number;
  stepNumber: number;
  type: "content" | "qa" | "photo" | "ask_availability" | "offer_slots" | "book";
  label: string;
  mode: "send" | "arm" | "automatic" | "schedule";
  actionLabel: string;
  textParts: number;
  mediaParts: number;
  preview: string | null;
};

export function ConvComposer({
  conversationId,
  aiPaused,
  leadName,
  treatmentInterest,
  temperature,
  leadStatus,
  conversationCategory,
  needsAttention,
  attentionReason,
  defaultDurationMinutes,
  timezone,
}: Props) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, startSend] = useTransition();
  const [isHandingOff, startHandoff] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipelineOptions, setPipelineOptions] = useState<PipelineOption[] | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);
  const [sendingPipelineKey, setSendingPipelineKey] = useState<string | null>(null);
  const [expandedPipelineTreatmentId, setExpandedPipelineTreatmentId] = useState<string | null>(null);
  // Etapa de fechamento do pipeline: exige o horário que será reservado
  // provisoriamente antes de pedir o sinal.
  const [depositSlotKey, setDepositSlotKey] = useState<string | null>(null);
  const [depositDate, setDepositDate] = useState("");
  const [depositTime, setDepositTime] = useState("");
  const [discountCustom, setDiscountCustom] = useState("");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedDuration, setSchedDuration] = useState(defaultDurationMinutes);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [isScheduling, startSchedule] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const retryMessageIdRef = useRef<string | null>(null);
  const router = useRouter();
  const isSalesConversation = isSalesConversationCategory(conversationCategory);

  const nextAction = isSalesConversation
    ? deriveNextAction({ temperature, status: leadStatus, needsAttention, attentionReason, aiPaused })
    : null;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => () => {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
  }, [attachmentPreviewUrl]);

  const clearAttachment = useCallback(() => {
    setAttachment(null);
    setAttachmentPreviewUrl(null);
    retryMessageIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleAttachmentSelected = useCallback((file: File) => {
    const inspection = inspectOperatorAttachment(file);
    if ("error" in inspection) {
      setError(inspection.error);
      clearAttachment();
      return;
    }
    setError(null);
    retryMessageIdRef.current = null;
    setAttachment(file);
    setAttachmentPreviewUrl(
      inspection.value.mediaType === "image" ? URL.createObjectURL(file) : null,
    );
  }, [clearAttachment]);

  const handleHandoff = useCallback(() => {
    if (isHandingOff) return;
    startHandoff(async () => {
      try {
        await fetch(`/api/conversations/${conversationId}/trigger-handoff`, { method: "POST" });
        router.refresh();
      } catch {
        setError("Não foi possível acionar o especialista. Tente novamente.");
      }
    });
  }, [isHandingOff, conversationId, router]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || isSending) return;
    setError(null);
    startSend(async () => {
      try {
        let uploadedAttachment: { url: string; fileName: string } | undefined;
        if (attachment) {
          const inspection = inspectOperatorAttachment(attachment);
          if ("error" in inspection) {
            setError(inspection.error);
            return;
          }
          const blob = await upload(
            `media/inbox/${conversationId}/${Date.now()}-${inspection.value.safeFileName}`,
            attachment,
            {
              access: "public",
              handleUploadUrl: `/api/conversations/${conversationId}/attachment-upload`,
              clientPayload: JSON.stringify({
                fileName: attachment.name,
                contentType: attachment.type,
                size: attachment.size,
              }),
              contentType: attachment.type || "application/octet-stream",
              multipart: attachment.size > 5 * 1024 * 1024,
            },
          );
          uploadedAttachment = {
            url: blob.url,
            fileName: inspection.value.safeFileName,
          };
        }
        const res = await fetch(`/api/conversations/${conversationId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            attachment: uploadedAttachment,
            clientMessageId: retryMessageIdRef.current ??= crypto.randomUUID(),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Erro ao enviar mensagem.");
          return;
        }
        setText("");
        retryMessageIdRef.current = null;
        clearAttachment();
        router.refresh();
      } catch {
        setError("Falha na conexão. Tente novamente.");
      }
    });
  }, [text, attachment, isSending, conversationId, clearAttachment, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestAi = async () => {
    if (isSuggesting) return;
    setIsSuggesting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/suggest-reply`);
      if (!res.ok) throw new Error("Erro");
      const data: { suggestion?: string } = await res.json();
      if (data.suggestion) {
        setText(data.suggestion);
        textareaRef.current?.focus();
      }
    } catch {
      setError("Não foi possível gerar sugestão. Tente novamente.");
    } finally {
      setIsSuggesting(false);
    }
  };

  function fillTemplate(template: string) {
    setText(template);
    textareaRef.current?.focus();
  }

  const loadPipelineActions = useCallback(async () => {
    if (isLoadingPipeline) return;
    setIsLoadingPipeline(true);
    setPipelineError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/pipeline-actions`);
      const data: { options?: PipelineOption[]; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineError(data.error ?? "Não foi possível carregar ações.");
        return;
      }
      setPipelineOptions(data.options ?? []);
    } catch {
      setPipelineError("Falha na conexão ao carregar ações.");
    } finally {
      setIsLoadingPipeline(false);
    }
  }, [conversationId, isLoadingPipeline]);

  const handleOpenPipeline = useCallback(() => {
    setPipelineOpen((open) => {
      const next = !open;
      if (next) {
        setScheduleOpen(false);
        setDiscountOpen(false);
        void loadPipelineActions();
      }
      return next;
    });
  }, [loadPipelineActions]);

  const handleSendPipelineAction = useCallback(async (option: PipelineOption, section?: PipelineSection) => {
    const key = `${option.treatmentId}:${section?.stepIndex ?? "start"}`;
    if (sendingPipelineKey) return;
    setSendingPipelineKey(key);
    setPipelineError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/pipeline-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treatmentId: option.treatmentId,
          action: option.summary.action,
          ...(section ? { stepIndex: section.stepIndex } : {}),
          ...(section?.mode === "schedule"
            ? { date: depositDate, time: depositTime, durationMinutes: defaultDurationMinutes }
            : {}),
        }),
      });
      const data: {
        error?: string;
        mode?: "rails_replay" | "armed_only" | "armed_selected_step" | "sent_first_content" | "sent_selected_step" | "deposit_requested";
        replied?: boolean;
        slotLabel?: string;
      } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setPipelineError(data.error ?? "Não foi possível ativar o fluxo.");
        return;
      }
      setPipelineOpen(false);
      setDepositSlotKey(null);
      setDepositDate("");
      setDepositTime("");
      setText("");
      if (data.mode === "deposit_requested") {
        setError(`Horário ${data.slotLabel ?? ""} reservado provisoriamente e sinal solicitado. Quando o comprovante chegar, valide por aqui para confirmar.`);
      } else if (data.mode === "armed_selected_step") {
        setError(`Pipeline posicionado em “${section?.label ?? "etapa escolhida"}” — a IA continua dali na próxima mensagem do lead.`);
      } else if (data.mode === "armed_only" || data.replied === false) {
        setError("Fluxo ativado — a IA conduz a partir da próxima mensagem do lead.");
      } else {
        setError(null);
      }
      router.refresh();
    } catch {
      setPipelineError("Falha na conexão ao enviar ação.");
    } finally {
      setSendingPipelineKey(null);
    }
  }, [conversationId, router, sendingPipelineKey, depositDate, depositTime, defaultDurationMinutes]);

  const handleLoadSlots = async () => {
    if (isLoadingSlots) return;
    setIsLoadingSlots(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/available-slots`);
      if (!res.ok) throw new Error("Erro");
      const data: { text?: string } = await res.json();
      if (data.text) {
        setText(data.text);
        textareaRef.current?.focus();
      }
    } catch {
      setError("Não foi possível buscar horários. Tente novamente.");
    } finally {
      setIsLoadingSlots(false);
    }
  };

  function handleOpenSchedule() {
    if (!scheduleOpen) {
      const now = new Date();
      const localStr = now.toLocaleString("sv-SE", { timeZone: timezone });
      const [datePart, timePart] = localStr.split(" ");
      setSchedDate(datePart);
      setSchedTime(timePart.slice(0, 5));
    }
    setPipelineOpen(false);
    setDiscountOpen(false);
    setScheduleOpen((v) => !v);
  }

  function handleScheduleSubmit() {
    if (!schedDate || !schedTime) return;
    setSchedError(null);
    startSchedule(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/register-appointment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: schedDate,
            time: schedTime,
            durationMinutes: schedDuration || defaultDurationMinutes,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setSchedError(data.error ?? "Erro ao registrar."); return; }
        setScheduleOpen(false);
        router.refresh();
      } catch {
        setSchedError("Falha na conexão.");
      }
    });
  }

  function applyDiscount(amount: number) {
    const greeting = leadName ? `Oi, ${leadName}!` : "Oi!";
    const subject = treatmentInterest ?? "nossos procedimentos";
    const msg = `${greeting} Tenho uma condição especial disponível por tempo limitado: R$${amount} de desconto em ${subject}. Quer aproveitar e já marcar sua avaliação?`;
    fillTemplate(msg);
    setDiscountOpen(false);
    setDiscountCustom("");
  }

  const proposalTemplate = treatmentInterest
    ? `Ótimo! Posso preparar uma proposta personalizada para ${treatmentInterest}. Você prefere receber por aqui ou quer agendar uma consulta de avaliação sem compromisso?`
    : `Ótimo! Posso preparar uma proposta personalizada para você. Qual é a melhor forma de te enviar?`;

  const casesTemplate = treatmentInterest
    ? `Vou te mostrar alguns casos reais de ${treatmentInterest} que realizamos. Um momento! 😊`
    : `Vou te enviar alguns casos reais do nosso trabalho. Um momento!`;

  return (
    <div className="conv-composer">
      {nextAction && (
        <div className="conv-next-action-bar">
          <Sparkles size={12} color="var(--accent-strong)" />
          <span className="conv-next-action-label">Próxima ação: {nextAction}</span>
        </div>
      )}

      {isSalesConversation ? (
        <div className="conv-chips-row">
          {!needsAttention && (
            <button
              className="conv-chip"
              onClick={handleHandoff}
              disabled={isHandingOff}
              title="Pausa a IA e sobe para needs_human — avisa que um especialista entrará em contato"
              style={{
                borderColor: "color-mix(in srgb, var(--warning) 40%, transparent)",
                color: "var(--warning)",
                fontWeight: 700,
              }}
            >
              <UserRoundCog size={12} />
              {isHandingOff ? "Acionando…" : "Especialista"}
            </button>
          )}

          <button
            className="conv-chip chip-ai"
            onClick={handleSuggestAi}
            disabled={isSuggesting}
            title="Gera uma sugestão de resposta com IA"
          >
            <Sparkles size={12} />
            {isSuggesting ? "Gerando…" : "Sugerir IA"}
          </button>

          <button
            className="conv-chip"
            onClick={() => fillTemplate(casesTemplate)}
            title="Pré-preenche resposta sobre casos reais"
          >
            Casos reais
          </button>

          <button
            className="conv-chip"
            onClick={handleOpenPipeline}
            disabled={isLoadingPipeline}
            title="Envia uma régua determinística do tratamento e retoma a IA no próximo passo"
            style={pipelineOpen ? { borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)", color: "var(--accent-strong)" } : undefined}
          >
            <ListChecks size={12} />
            {isLoadingPipeline ? "Carregando…" : "Pipeline"}
          </button>

          <button
            className="conv-chip"
            onClick={handleLoadSlots}
            disabled={isLoadingSlots}
            title="Busca os próximos horários disponíveis e pré-preenche o campo"
          >
            <Clock size={12} />
            {isLoadingSlots ? "Buscando…" : "Horários"}
          </button>

          <button
            className="conv-chip"
            onClick={() => fillTemplate(proposalTemplate)}
            title="Pré-preenche template de proposta"
          >
            Proposta
          </button>

          <button
            className="conv-chip"
            onClick={handleOpenSchedule}
            title="Registrar agendamento"
          >
            <Calendar size={12} />
            Agendar
          </button>

          <button
            className="conv-chip"
            onClick={() => { setDiscountOpen((v) => !v); setScheduleOpen(false); setPipelineOpen(false); }}
            title="Enviar oferta com desconto"
            style={discountOpen ? { borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)", color: "var(--accent-strong)" } : undefined}
          >
            <Tag size={12} />
            Desconto
          </button>
        </div>
      ) : (
        <div className="conv-next-action-bar" style={{ marginTop: 6 }}>
          <AlertCircle size={12} color="var(--warning)" />
          <span className="conv-next-action-label">
            Conversa fora do funil comercial. Chips de venda e automações estão desativados.
          </span>
        </div>
      )}

      {isSalesConversation && scheduleOpen && (
        <div className="conv-schedule-panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 4px" }}>
            {schedError && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--danger)" }}>
                <AlertCircle size={13} />
                {schedError}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Data</label>
                <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Horário</label>
                <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Duração</label>
              <DurationHoursInput minutes={schedDuration} onChangeMinutes={setSchedDuration} inputStyle={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="primary-button"
                style={{ flex: 1, justifyContent: "center", gap: 6 }}
                onClick={handleScheduleSubmit}
                disabled={!schedDate || !schedTime || isScheduling}
              >
                <CalendarPlus size={13} />
                {isScheduling ? "Registrando…" : "Confirmar"}
              </button>
              <button className="secondary-button" onClick={() => setScheduleOpen(false)} disabled={isScheduling}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isSalesConversation && pipelineOpen && (
        <div className="conv-schedule-panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 4px" }}>
            {pipelineError && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--danger)" }}>
                <AlertCircle size={13} />
                {pipelineError}
              </div>
            )}
            {isLoadingPipeline && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Carregando ações disponíveis…</span>
            )}
            {!isLoadingPipeline && pipelineOptions?.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Nenhum tratamento com pipeline configurado nesta clínica.
              </span>
            )}
            {pipelineOptions?.map((option) => {
              const isExpanded = expandedPipelineTreatmentId === option.treatmentId;
              const startKey = `${option.treatmentId}:start`;
              return (
                <div
                  key={option.treatmentId}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 9,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    width: "100%",
                  }}
                >
                  <button
                    className="secondary-button"
                    style={{
                      alignItems: "flex-start",
                      border: 0,
                      borderRadius: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "9px 10px",
                      textAlign: "left",
                      width: "100%",
                    }}
                    onClick={() => setExpandedPipelineTreatmentId(isExpanded ? null : option.treatmentId)}
                    aria-expanded={isExpanded}
                  >
                    <span style={{ alignItems: "center", color: "var(--text)", display: "flex", fontSize: 13, fontWeight: 700, justifyContent: "space-between", width: "100%" }}>
                      {option.treatmentName}
                      <span aria-hidden>{isExpanded ? "▴" : "▾"}</span>
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600 }}>
                      {option.sections.length} etapas · escolha onde entrar
                    </span>
                  </button>

                  {isExpanded && (
                    <div style={{ borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
                      <button
                        className="secondary-button"
                        disabled={Boolean(sendingPipelineKey)}
                        onClick={() => void handleSendPipelineAction(option)}
                        style={{ fontSize: 11, justifyContent: "center", width: "100%" }}
                      >
                        {sendingPipelineKey === startKey ? "Ativando…" : "Começar do início"}
                      </button>

                      {option.sections.map((section) => {
                        const sectionKey = `${option.treatmentId}:${section.stepIndex}`;
                        const isAutomatic = section.mode === "automatic";
                        const isSchedule = section.mode === "schedule";
                        const isPickingSlot = isSchedule && depositSlotKey === sectionKey;
                        return (
                          <div key={sectionKey} style={{ width: "100%" }}>
                            <button
                              className="secondary-button"
                              disabled={Boolean(sendingPipelineKey) || isAutomatic}
                              onClick={() => {
                                if (isSchedule) {
                                  setDepositSlotKey(isPickingSlot ? null : sectionKey);
                                  return;
                                }
                                void handleSendPipelineAction(option, section);
                              }}
                              style={{
                                alignItems: "flex-start",
                                display: "flex",
                                flexDirection: "column",
                                gap: 3,
                                opacity: isAutomatic ? 0.55 : 1,
                                padding: "8px 10px",
                                textAlign: "left",
                                width: "100%",
                              }}
                              title={isAutomatic ? "Esta etapa é executada pelo motor do pipeline" : section.actionLabel}
                            >
                              <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>
                                {section.stepNumber}. {section.label}
                              </span>
                              <span style={{ color: "var(--accent-strong)", fontSize: 10, fontWeight: 700 }}>
                                {sendingPipelineKey === sectionKey ? "Enviando…" : section.actionLabel}
                                {section.mediaParts > 0 ? ` · ${section.mediaParts} mídia(s)` : ""}
                              </span>
                              {section.preview && (
                                <span style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.35 }}>
                                  {section.preview}
                                </span>
                              )}
                            </button>

                            {isPickingSlot && (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  padding: "8px 10px",
                                  alignItems: "center",
                                }}
                              >
                                <span style={{ color: "var(--muted)", fontSize: 10, width: "100%" }}>
                                  O horário fica reservado provisoriamente e o sinal é pedido ao lead. A
                                  confirmação só acontece após o comprovante ser validado.
                                </span>
                                <input
                                  type="date"
                                  value={depositDate}
                                  onChange={(e) => setDepositDate(e.target.value)}
                                  style={{ fontSize: 12, padding: "5px 7px" }}
                                />
                                <input
                                  type="time"
                                  value={depositTime}
                                  onChange={(e) => setDepositTime(e.target.value)}
                                  step={900}
                                  style={{ fontSize: 12, padding: "5px 7px" }}
                                />
                                <button
                                  className="primary-button"
                                  disabled={!depositDate || !depositTime || Boolean(sendingPipelineKey)}
                                  onClick={() => void handleSendPipelineAction(option, section)}
                                  style={{ fontSize: 12, padding: "6px 12px" }}
                                >
                                  {sendingPipelineKey === sectionKey ? "Reservando…" : "Reservar e pedir sinal"}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isSalesConversation && discountOpen && (
        <div className="conv-schedule-panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 4px" }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Selecione o valor do desconto</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DISCOUNT_PRESETS.map((amount) => (
                <button
                  key={amount}
                  className="secondary-button"
                  style={{ fontSize: 13, padding: "5px 14px" }}
                  onClick={() => applyDiscount(amount)}
                >
                  R${amount}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="number"
                min={50}
                placeholder="Outro valor (R$)"
                value={discountCustom}
                onChange={(e) => setDiscountCustom(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
                onKeyDown={(e) => { if (e.key === "Enter" && discountCustom) applyDiscount(Number(discountCustom)); }}
              />
              <button
                className="primary-button"
                style={{ flexShrink: 0 }}
                disabled={!discountCustom || Number(discountCustom) < 50}
                onClick={() => applyDiscount(Number(discountCustom))}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="conv-composer-error">
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      {attachment && (
        <div className="conv-attachment-preview">
          <div className="conv-attachment-thumb">
            {attachmentPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentPreviewUrl} alt="Prévia do anexo" />
            ) : attachment.type.startsWith("video/") ? (
              <Film size={20} />
            ) : attachment.type.startsWith("image/") ? (
              <ImageIcon size={20} />
            ) : (
              <FileText size={20} />
            )}
          </div>
          <div className="conv-attachment-info">
            <strong>{attachment.name}</strong>
            <span>{formatAttachmentSize(attachment.size)}</span>
          </div>
          <button type="button" onClick={clearAttachment} disabled={isSending} aria-label="Remover anexo">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="conv-input-row">
        <input
          ref={fileInputRef}
          type="file"
          accept={OPERATOR_ATTACHMENT_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleAttachmentSelected(file);
          }}
        />
        <button
          type="button"
          className="conv-attachment-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          title="Anexar foto, vídeo ou documento"
          aria-label="Anexar arquivo"
        >
          <Paperclip size={17} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            retryMessageIdRef.current = null;
          }}
          onKeyDown={handleKeyDown}
          placeholder={attachment ? "Adicionar uma legenda…" : "Responder como operador…"}
          rows={1}
          disabled={isSending}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="send"
        />
        <button
          className="conv-send-btn"
          onClick={handleSend}
          disabled={(!text.trim() && !attachment) || isSending}
          title="Enviar"
        >
          {isSending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  colorScheme: "dark",
};
