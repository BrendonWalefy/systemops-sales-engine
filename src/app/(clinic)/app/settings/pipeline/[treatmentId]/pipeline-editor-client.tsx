"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Save,
  CheckCircle2,
  Loader2,
  FileText,
  MessageSquare,
  Camera,
  CalendarCheck,
  CalendarDays,
  BookOpen,
  Film,
  AlignLeft,
  ChevronDown,
  GripVertical,
  Info,
} from "lucide-react";
import { savePipelineSteps } from "../actions";
import type { PipelineStep, ContentBlock } from "@/domain/entities/treatment";

type MediaItem = { id: string; title: string; url: string; type: "video" | "image"; treatmentId: string | null };

type Props = {
  treatment: {
    id: string;
    name: string;
    pipelineSteps: PipelineStep[] | null;
    ownPipelineSteps: PipelineStep[] | null;
    pipelineSourceTreatmentId: string | null;
    pipelineEntryBehavior: "immediate" | "qualify_then_present" | null;
  };
  pipelineSources: Array<{ id: string; name: string; pipelineSteps: PipelineStep[] }>;
  mediaLibrary: MediaItem[];
};

// ─── Step type config ─────────────────────────────────────────────────────────

const STEP_TYPES = [
  { type: "content", label: "Conteúdo", Icon: FileText, description: "Blocos de texto e mídia enviados em sequência", color: "#00d4aa" },
  { type: "qa", label: "Q&A", Icon: MessageSquare, description: "Período de perguntas guiado por instrução ao LLM", color: "#a78bfa" },
  { type: "photo", label: "Foto", Icon: Camera, description: "Solicita foto ao lead", color: "#60a5fa" },
  { type: "ask_availability", label: "Disponibilidade", Icon: CalendarDays, description: "Marcador: perguntar disponibilidade", color: "#fbbf24" },
  { type: "offer_slots", label: "Horários", Icon: CalendarCheck, description: "Marcador: mostrar horários disponíveis", color: "#fbbf24" },
  { type: "book", label: "Agendamento", Icon: BookOpen, description: "Marcador: confirmar agendamento", color: "#4ade80" },
] as const;

type StepType = (typeof STEP_TYPES)[number]["type"];

// Aviso não-bloqueante: o tratamento tem mídia própria cadastrada (treatmentId bate
// com este tratamento — mídia geral fica de fora para não gerar ruído, já que
// legitimamente nunca aparece em um step de conteúdo), mas nenhum step de Conteúdo
// do pipeline a referencia. Sinal de que o vídeo/imagem foi esquecido na apresentação
// inicial — o mesmo gap que deixou a Vitalli sem vídeo na primeira resposta sobre
// lentes (o Q&A livre da IA continua tendo acesso à mídia normalmente).
export function computeMediaGapWarning(
  steps: PipelineStep[],
  mediaLibrary: { id: string; treatmentId: string | null }[],
  treatmentId: string,
): { show: boolean; contentStepIndexes: number[]; treatmentSpecificMediaCount: number } {
  const treatmentSpecificMedia = mediaLibrary.filter((m) => m.treatmentId === treatmentId);
  const contentStepIndexes = steps
    .map((s, i) => (s.type === "content" ? i : -1))
    .filter((i) => i !== -1);
  const usedMediaIds = new Set(
    steps.flatMap((s) => (s.type === "content" ? s.blocks.filter((b) => b.kind === "media").map((b) => b.mediaId) : [])),
  );
  const show =
    contentStepIndexes.length > 0 &&
    treatmentSpecificMedia.length > 0 &&
    treatmentSpecificMedia.every((m) => !usedMediaIds.has(m.id));

  return { show, contentStepIndexes, treatmentSpecificMediaCount: treatmentSpecificMedia.length };
}

function stepColor(type: string): string {
  return STEP_TYPES.find((s) => s.type === type)?.color ?? "var(--muted)";
}

function stepLabel(type: string): string {
  return STEP_TYPES.find((s) => s.type === type)?.label ?? type;
}

function defaultStep(type: StepType): PipelineStep {
  switch (type) {
    case "content":
      return { type: "content", label: "Nova etapa de conteúdo", blocks: [{ kind: "text", content: "" }] };
    case "qa":
      return { type: "qa", label: "Sessão de perguntas", instruction: "", maxTurns: 10 };
    case "photo":
      return { type: "photo", label: "Solicitar foto", message: "", required: false };
    case "ask_availability":
      return { type: "ask_availability", label: "Perguntar disponibilidade" };
    case "offer_slots":
      return { type: "offer_slots", label: "Mostrar horários" };
    case "book":
      return { type: "book", label: "Confirmar agendamento" };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBadge({ type }: { type: string }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "3px 8px",
        borderRadius: "6px",
        background: `${stepColor(type)}18`,
        color: stepColor(type),
        border: `1px solid ${stepColor(type)}33`,
        whiteSpace: "nowrap",
      }}
    >
      {stepLabel(type).toUpperCase()}
    </span>
  );
}

function ContentBlockEditor({
  block,
  mediaLibrary,
  onChange,
  onRemove,
}: {
  block: ContentBlock;
  mediaLibrary: MediaItem[];
  onChange: (b: ContentBlock) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="pipeline-content-block"
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "flex-start",
        padding: "10px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {block.kind === "text" ? (
        <AlignLeft size={14} strokeWidth={2} style={{ color: "var(--muted)", marginTop: "3px", flexShrink: 0 }} />
      ) : (
        <Film size={14} strokeWidth={2} style={{ color: "#60a5fa", marginTop: "3px", flexShrink: 0 }} />
      )}

      <div className="pipeline-content-block-main" style={{ flex: 1 }}>
        {block.kind === "text" ? (
          <textarea
            value={block.content}
            onChange={(e) => onChange({ ...block, content: e.target.value })}
            placeholder="Texto da mensagem..."
            rows={3}
            style={{
              width: "100%",
              resize: "vertical",
              margin: 0,
              fontSize: "13px",
              fontFamily: "inherit",
              minHeight: "72px",
            }}
          />
        ) : (
          <div>
            {mediaLibrary.length > 0 ? (
              <select
                value={block.mediaId}
                onChange={(e) => onChange({ ...block, mediaId: e.target.value })}
                style={{ width: "100%", margin: 0, fontSize: "13px" }}
              >
                <option value="">— Selecionar mídia —</option>
                {mediaLibrary.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title || m.url} ({m.type})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={block.mediaId}
                onChange={(e) => onChange({ ...block, mediaId: e.target.value })}
                placeholder="ID da mídia..."
                style={{ width: "100%", margin: 0, fontSize: "13px" }}
              />
            )}
            <input
              type="text"
              value={block.caption ?? ""}
              onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
              placeholder="Legenda (opcional) — enviada como texto após o vídeo"
              style={{ width: "100%", margin: "6px 0 0", fontSize: "12px" }}
            />
            <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
              Mídias são gerenciadas na{" "}
              <Link href="/app/settings/playbook" style={{ color: "var(--accent)" }}>
                Biblioteca de Mídia
              </Link>
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Remover bloco"
        style={{
          background: "transparent",
          border: "none",
          padding: "4px",
          cursor: "pointer",
          color: "var(--muted)",
          flexShrink: 0,
        }}
      >
        <Trash2 size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  mediaLibrary,
  onChange,
  onRemove,
  onMove,
}: {
  step: PipelineStep;
  index: number;
  total: number;
  mediaLibrary: MediaItem[];
  onChange: (s: PipelineStep) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  const isMarker = step.type === "ask_availability" || step.type === "offer_slots" || step.type === "book";

  return (
    <div
      className="pipeline-step-card"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {/* Header */}
      <div
        className="pipeline-step-card-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderBottom: isMarker ? undefined : "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <GripVertical size={13} strokeWidth={2} style={{ color: "rgba(255,255,255,0.18)", flexShrink: 0 }} />
        <StepBadge type={step.type} />
        <input
          type="text"
          value={step.label}
          onChange={(e) => onChange({ ...step, label: e.target.value } as PipelineStep)}
          placeholder="Nome da etapa..."
          style={{
            flex: 1,
            margin: 0,
            minWidth: 0,
            fontSize: "13px",
            fontWeight: 600,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            padding: "0",
          }}
        />
        <div className="pipeline-step-card-actions" style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={index === 0}
            title="Mover para cima"
            style={arrowBtnStyle(index === 0)}
          >
            <ArrowUp size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={index === total - 1}
            title="Mover para baixo"
            style={arrowBtnStyle(index === total - 1)}
          >
            <ArrowDown size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remover etapa"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "6px",
              padding: "3px 6px",
              cursor: "pointer",
              color: "#f87171",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Body — type-specific fields */}
      {step.type === "content" && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
            Blocos
          </p>
          {step.blocks.map((block, bi) => (
            <ContentBlockEditor
              key={bi}
              block={block}
              mediaLibrary={mediaLibrary}
              onChange={(b) => {
                const blocks = [...step.blocks];
                blocks[bi] = b;
                onChange({ ...step, blocks });
              }}
              onRemove={() => {
                const blocks = step.blocks.filter((_, i) => i !== bi);
                onChange({ ...step, blocks });
              }}
            />
          ))}
          <div className="pipeline-block-actions" style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              type="button"
              onClick={() => onChange({ ...step, blocks: [...step.blocks, { kind: "text", content: "" }] })}
              style={addBlockBtnStyle}
            >
              <AlignLeft size={12} strokeWidth={2} />
              Texto
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...step, blocks: [...step.blocks, { kind: "media", mediaId: "" }] })}
              style={addBlockBtnStyle}
            >
              <Film size={12} strokeWidth={2} />
              Mídia
            </button>
          </div>
        </div>
      )}

      {step.type === "qa" && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Instrução para a IA</label>
            <textarea
              value={step.instruction ?? ""}
              onChange={(e) => onChange({ ...step, instruction: e.target.value })}
              placeholder="Ex: Responda dúvidas sobre as técnicas. Não mencione preços além da política comercial."
              rows={3}
              style={{ width: "100%", resize: "vertical", margin: 0, fontSize: "13px", fontFamily: "inherit" }}
            />
          </div>
          <div className="pipeline-qa-turns-row" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Máx. turnos de Q&A</label>
            <input
              type="number"
              value={step.maxTurns ?? 10}
              min={1}
              max={50}
              onChange={(e) => onChange({ ...step, maxTurns: parseInt(e.target.value) || 10 })}
              style={{ width: "72px", margin: 0, fontSize: "13px", textAlign: "center" }}
            />
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>trocas antes de sugerir agendamento</span>
          </div>
        </div>
      )}

      {step.type === "photo" && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Mensagem enviada ao lead</label>
            <textarea
              value={step.message}
              onChange={(e) => onChange({ ...step, message: e.target.value })}
              placeholder="Ex: Para que o Dr. possa te dar uma recomendação personalizada, você poderia nos enviar uma foto do seu sorriso?"
              rows={3}
              style={{ width: "100%", resize: "vertical", margin: 0, fontSize: "13px", fontFamily: "inherit" }}
            />
          </div>
          <label className="pipeline-checkbox-row" style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={step.required}
              onChange={(e) => onChange({ ...step, required: e.target.checked })}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
            <span style={{ fontSize: "13px" }}>Obrigatória — bloqueia agendamento até foto recebida</span>
          </label>
        </div>
      )}

      {isMarker && (
        <div style={{ padding: "10px 16px" }}>
          <p style={{ fontSize: "12px", color: "var(--muted)", fontStyle: "italic" }}>
            Marcador de fluxo — sem configuração adicional. A IA assume esta etapa automaticamente.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Add step menu ────────────────────────────────────────────────────────────

function AddStepMenu({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);

  const active = STEP_TYPES.filter((s) => ["content", "qa", "photo"].includes(s.type));
  const markers = STEP_TYPES.filter((s) => ["ask_availability", "offer_slots", "book"].includes(s.type));

  return (
    <div className="pipeline-add-step-menu" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 16px",
          background: "rgba(0,212,170,0.06)",
          border: "1px dashed rgba(0,212,170,0.3)",
          borderRadius: "10px",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          width: "100%",
          justifyContent: "center",
        }}
      >
        <Plus size={15} strokeWidth={2.5} />
        Adicionar etapa
        <ChevronDown size={14} strokeWidth={2} style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          className="add-step-menu-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            background: "var(--surface-2, #1c1c1e)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            overflow: "hidden",
            zIndex: 50,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ padding: "8px 12px 4px", fontSize: "10px", color: "var(--muted)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Etapas ativas
          </div>
          {active.map(({ type, label, Icon, description, color }) => (
            <button
              key={type}
              type="button"
              onClick={() => { onAdd(type as StepType); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "10px 12px",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <Icon size={16} strokeWidth={2} style={{ color, marginTop: "1px", flexShrink: 0 }} />
              <div className="pipeline-add-step-copy">
                <div style={{ fontSize: "13px", fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>{description}</div>
              </div>
            </button>
          ))}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <div style={{ padding: "8px 12px 4px", fontSize: "10px", color: "var(--muted)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Marcadores de fluxo
          </div>
          {markers.map(({ type, label, Icon, description, color }) => (
            <button
              key={type}
              type="button"
              onClick={() => { onAdd(type as StepType); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "10px 12px",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <Icon size={16} strokeWidth={2} style={{ color, marginTop: "1px", flexShrink: 0 }} />
              <div className="pipeline-add-step-copy">
                <div style={{ fontSize: "13px", fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>{description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function PipelineEditorClient({ treatment, pipelineSources, mediaLibrary }: Props) {
  const [steps, setSteps] = useState<PipelineStep[]>(treatment.ownPipelineSteps ?? []);
  const [pipelineSourceTreatmentId, setPipelineSourceTreatmentId] = useState(
    treatment.pipelineSourceTreatmentId ?? "",
  );
  const [pipelineEntryBehavior, setPipelineEntryBehavior] = useState(
    treatment.pipelineEntryBehavior ?? "",
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedSource = pipelineSources.find(
    (candidate) => candidate.id === pipelineSourceTreatmentId,
  );
  const visibleSteps = selectedSource?.pipelineSteps ?? steps;
  const isInherited = Boolean(selectedSource);

  function updateStep(index: number, step: PipelineStep) {
    setSaved(false);
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }

  function removeStep(index: number) {
    setSaved(false);
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, dir: "up" | "down") {
    setSaved(false);
    setSteps((prev) => {
      const next = [...prev];
      const target = dir === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStep(type: StepType) {
    setSaved(false);
    setSteps((prev) => [...prev, defaultStep(type)]);
  }

  const { show: showMediaGapWarning, contentStepIndexes, treatmentSpecificMediaCount } = computeMediaGapWarning(
    visibleSteps,
    mediaLibrary,
    treatment.id,
  );

  function addMediaToFirstContentStep() {
    const idx = contentStepIndexes[0];
    const step = visibleSteps[idx];
    if (step.type !== "content") return;
    updateStep(idx, { ...step, blocks: [...step.blocks, { kind: "media", mediaId: "" }] });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await savePipelineSteps(treatment.id, steps, {
        pipelineSourceTreatmentId: pipelineSourceTreatmentId || null,
        pipelineEntryBehavior:
          pipelineEntryBehavior === "immediate" ||
          pipelineEntryBehavior === "qualify_then_present"
            ? pipelineEntryBehavior
            : null,
      });
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(result.error ?? "Erro ao salvar");
      }
    });
  }

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div className="pipeline-editor-header">
        <div className="pipeline-editor-title-group" style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <Link
            href="/app/settings/pipeline"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: "13px",
              padding: "5px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Pipeline
          </Link>

          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "17px", fontWeight: 700, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {treatment.name}
            </h1>
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: "1px 0 0" }}>
              {visibleSteps.length === 0 ? "Sem etapas configuradas" : `${visibleSteps.length} ${visibleSteps.length === 1 ? "etapa" : "etapas"}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="primary-button"
          style={{ padding: "8px 16px", gap: "7px", fontSize: "13px", flexShrink: 0 }}
        >
          {isPending ? (
            <>
              <Loader2 size={14} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
              Salvando...
            </>
          ) : saved ? (
            <>
              <CheckCircle2 size={14} strokeWidth={2} />
              Salvo
            </>
          ) : (
            <>
              <Save size={14} strokeWidth={2} />
              Salvar pipeline
            </>
          )}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: "8px",
            color: "#f87171",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr)",
          gap: "12px",
          padding: "14px",
          marginBottom: "16px",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <label style={{ fontSize: "12px", color: "var(--muted)" }}>
          <span style={labelStyle}>Jornada canônica</span>
          <select
            value={pipelineSourceTreatmentId}
            onChange={(event) => {
              setPipelineSourceTreatmentId(event.target.value);
              setSaved(false);
            }}
            style={{ width: "100%", minHeight: "38px" }}
          >
            <option value="">Este tratamento possui a jornada</option>
            {pipelineSources.map((source) => (
              <option key={source.id} value={source.id}>
                Herdar de {source.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "12px", color: "var(--muted)" }}>
          <span style={labelStyle}>Entrada na apresentação</span>
          <select
            value={pipelineEntryBehavior}
            onChange={(event) => {
              setPipelineEntryBehavior(event.target.value);
              setSaved(false);
            }}
            style={{ width: "100%", minHeight: "38px" }}
          >
            <option value="">Padrão atual da clínica</option>
            <option value="immediate">Imediata — conteúdo e mídias no primeiro turno</option>
            <option value="qualify_then_present">Qualificar e apresentar na resposta seguinte</option>
          </select>
        </label>
        {isInherited && (
          <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: "12px", color: "#a7f3d0" }}>
            Esta é uma variante comercial. Preço e duração continuam próprios; as etapas abaixo vêm de{" "}
            <strong>{selectedSource?.name}</strong> e não são duplicadas.
          </p>
        )}
      </div>

      {!isInherited && showMediaGapWarning && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "10px 14px",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <Info size={15} strokeWidth={2} style={{ color: "#fbbf24", marginTop: "2px", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: "13px", margin: 0, color: "var(--foreground)" }}>
              Este tratamento tem {treatmentSpecificMediaCount}{" "}
              {treatmentSpecificMediaCount === 1 ? "mídia" : "mídias"} própria na biblioteca, mas nenhum step de
              Conteúdo do pipeline usa nenhuma delas — hoje elas só entram se a IA decidir puxar durante o Q&A livre.
            </p>
            <button
              type="button"
              onClick={addMediaToFirstContentStep}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "8px",
                padding: "5px 10px",
                background: "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: "6px",
                color: "#fbbf24",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <Film size={12} strokeWidth={2} />
              Adicionar bloco de mídia ao primeiro step de Conteúdo
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleSteps.length === 0 && (
        <div
          style={{
            padding: "32px 24px",
            textAlign: "center",
            color: "var(--muted)",
            border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: "12px",
            marginBottom: "16px",
          }}
        >
          <p style={{ fontSize: "14px", marginBottom: "4px" }}>Nenhuma etapa configurada</p>
          <p style={{ fontSize: "12px" }}>
            Sem pipeline, este procedimento usa o fluxo reativo padrão — a IA responde livre.
          </p>
        </div>
      )}

      {/* Steps list */}
      <div
        className="pipeline-steps-list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginBottom: "16px",
          ...(isInherited ? { pointerEvents: "none", opacity: 0.72 } : {}),
        }}
      >
        {visibleSteps.map((step, i) => (
          <StepCard
            key={i}
            step={step}
            index={i}
            total={visibleSteps.length}
            mediaLibrary={mediaLibrary}
            onChange={(s) => updateStep(i, s)}
            onRemove={() => removeStep(i)}
            onMove={(dir) => moveStep(i, dir)}
          />
        ))}
      </div>

      {/* Add step */}
      {!isInherited && <AddStepMenu onAdd={addStep} />}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: "6px",
};

const addBlockBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 12px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
};

function arrowBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    padding: "4px 6px",
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "rgba(255,255,255,0.2)" : "var(--muted)",
    display: "flex",
    alignItems: "center",
    opacity: disabled ? 0.4 : 1,
  };
}
