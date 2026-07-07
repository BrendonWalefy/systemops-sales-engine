"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, CheckCircle2 } from "lucide-react";
import { answerFinding, concludeValidation } from "./actions";
import type {
  SetupFinding,
  SetupFindingCategory,
} from "@/domain/entities/setup-study";
import { parseEvidenceSegments } from "@/application/setup-study/format-evidence";
import type { EvidenceRole } from "@/application/setup-study/format-evidence";

/** Rótulos leigos por categoria (o cliente não vê os nomes técnicos). */
const CATEGORY_LABEL: Record<SetupFindingCategory, string> = {
  price: "Valores",
  communication: "Atendimento",
  qualification: "Triagem",
  policy: "Políticas",
  tone: "Tom de voz",
  other: "Outros",
};

type LocalAnswer =
  | { status: "confirmed" }
  | { status: "corrected"; correction: string };

export function ValidationForm({
  token,
  clinicName,
  findings,
}: {
  token: string;
  clinicName: string;
  findings: SetupFinding[];
}) {
  const router = useRouter();
  const [concluding, startConclude] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Estado local das respostas, inicializado com o que já veio persistido.
  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>(() => {
    const seed: Record<string, LocalAnswer> = {};
    for (const f of findings) {
      if (f.answer?.status === "confirmed") seed[f.id] = { status: "confirmed" };
      else if (f.answer?.status === "corrected")
        seed[f.id] = { status: "corrected", correction: f.answer.correction ?? "" };
    }
    return seed;
  });

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === findings.length && findings.length > 0;

  const handleConclude = () => {
    setError(null);
    startConclude(async () => {
      try {
        await concludeValidation(token);
        router.refresh(); // a página passa a resolver o estado "answered"
      } catch (err: unknown) {
        setError((err as Error).message || "Não foi possível concluir.");
      }
    });
  };

  const recordAnswer = (findingId: string, answer: LocalAnswer) =>
    setAnswers((prev) => ({ ...prev, [findingId]: answer }));

  return (
    <div style={{ maxWidth: 560, width: "100%", margin: "0 auto", display: "grid", gap: 20 }}>
      {/* Cabeçalho */}
      <header style={{ display: "grid", gap: 8, paddingTop: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#a3e635", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          SystemOps
        </span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, lineHeight: 1.25 }}>
          Confira o que aprendemos com os atendimentos da {clinicName}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "#a1a1aa" }}>
          Lemos as conversas recentes e anotamos alguns pontos. Em cada um, toque
          em <strong style={{ color: "#fafafa" }}>Está certo</strong> se estiver
          correto, ou <strong style={{ color: "#fafafa" }}>Corrigir</strong> para
          escrever do seu jeito. Leva poucos minutos.
        </p>
      </header>

      {/* Progresso */}
      <div style={{ fontSize: 13, color: "#a1a1aa", fontWeight: 600 }}>
        {answeredCount} de {findings.length} respondidos
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gap: 14 }}>
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            token={token}
            finding={f}
            answer={answers[f.id]}
            onAnswered={(a) => recordAnswer(f.id, a)}
          />
        ))}
      </div>

      {/* Conclusão */}
      {error && (
        <p style={{ margin: 0, fontSize: 14, color: "#f87171", textAlign: "center" }}>{error}</p>
      )}
      <button
        onClick={handleConclude}
        disabled={!allAnswered || concluding}
        style={{
          padding: "16px 20px",
          borderRadius: 12,
          border: "none",
          background: allAnswered ? "#a3e635" : "#27272a",
          color: allAnswered ? "#000" : "#71717a",
          fontSize: 16,
          fontWeight: 800,
          cursor: allAnswered && !concluding ? "pointer" : "not-allowed",
          position: "sticky",
          bottom: 12,
        }}
      >
        {concluding
          ? "Enviando..."
          : allAnswered
            ? "Concluir e enviar"
            : `Responda todos para concluir — falta${findings.length - answeredCount === 1 ? "" : "m"} ${findings.length - answeredCount}`}
      </button>
    </div>
  );
}

function FindingCard({
  token,
  finding,
  answer,
  onAnswered,
}: {
  token: string;
  finding: SetupFinding;
  answer: LocalAnswer | undefined;
  onAnswered: (a: LocalAnswer) => void;
}) {
  const [saving, startSave] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    answer?.status === "corrected" ? answer.correction : "",
  );
  const [error, setError] = useState<string | null>(null);

  const categoryLabel = useMemo(
    () => CATEGORY_LABEL[finding.category] ?? "Outros",
    [finding.category],
  );

  const save = (input: { status: "confirmed" | "corrected"; correction?: string }) => {
    setError(null);
    startSave(async () => {
      try {
        await answerFinding(token, finding.id, input);
        if (input.status === "confirmed") {
          onAnswered({ status: "confirmed" });
        } else {
          onAnswered({ status: "corrected", correction: input.correction ?? "" });
          setEditing(false);
        }
      } catch (err: unknown) {
        setError((err as Error).message || "Não foi possível salvar.");
      }
    });
  };

  const isConfirmed = answer?.status === "confirmed";
  const isCorrected = answer?.status === "corrected";

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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#a1a1aa", background: "#1f1f23", padding: "3px 8px", borderRadius: 6 }}>
          {categoryLabel}
        </span>
        {answer && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#a3e635" }}>
            <CheckCircle2 size={14} /> {isConfirmed ? "Confirmado" : "Corrigido"}
          </span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
        {finding.claim}
      </p>

      {finding.evidence && (
        <EvidenceRenderer evidence={finding.evidence} />
      )}

      {/* Correção existente (não editando) */}
      {isCorrected && !editing && (
        <div style={{ padding: "10px 12px", background: "rgba(163,230,53,0.06)", borderRadius: 8, fontSize: 14, lineHeight: 1.5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#a3e635", display: "block", marginBottom: 4 }}>
            Sua correção
          </span>
          {(answer as { correction: string }).correction}
        </div>
      )}

      {editing ? (
        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
            rows={4}
            autoFocus
            placeholder="Escreva como realmente é..."
            style={{ width: "100%", resize: "vertical", fontSize: 15, lineHeight: 1.45, padding: "12px", borderRadius: 10, border: "1px solid #a3e635", background: "#0d0d0f", color: "#fafafa", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => save({ status: "corrected", correction: draft })}
              disabled={saving || !draft.trim()}
              style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#a3e635", color: "#000", fontSize: 15, fontWeight: 700, cursor: draft.trim() ? "pointer" : "not-allowed", opacity: draft.trim() ? 1 : 0.5 }}
            >
              Salvar correção
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(answer?.status === "corrected" ? answer.correction : ""); }}
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
            onClick={() => save({ status: "confirmed" })}
            disabled={saving}
            style={{
              flex: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "12px", borderRadius: 10,
              border: isConfirmed ? "none" : "1px solid #3f3f46",
              background: isConfirmed ? "#a3e635" : "transparent",
              color: isConfirmed ? "#000" : "#fafafa",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Check size={16} /> Está certo
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={saving}
            style={{
              flex: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "12px", borderRadius: 10,
              border: "1px solid #3f3f46",
              background: "transparent",
              color: "#fafafa",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Pencil size={15} /> {isCorrected ? "Editar correção" : "Corrigir"}
          </button>
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "#f87171" }}>{error}</p>
      )}
    </div>
  );
}

function EvidenceRenderer({ evidence }: { evidence: string }) {
  const segments = parseEvidenceSegments(evidence);
  const hasRole = segments.some((s) => s.role !== null);

  if (!hasRole) {
    return (
      <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, borderLeft: "2px solid #3f3f46", fontSize: 13, color: "#a1a1aa", fontStyle: "italic", lineHeight: 1.5 }}>
        &ldquo;{evidence}&rdquo;
      </div>
    );
  }

  const roleLabel: Record<Exclude<EvidenceRole, null>, string> = {
    clinica: "Atendente",
    paciente: "Paciente",
    ia: "Assistente IA (em observação)",
    sistema: "Sistema",
  };

  return (
    <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, borderLeft: "2px solid #3f3f46", fontSize: 13, color: "#a1a1aa", lineHeight: 1.5, display: "grid", gap: 6 }}>
      {segments.map((s, idx) => (
        <div key={idx}>
          {s.role && (
            <span style={{ fontWeight: 700, color: "#fafafa", fontSize: 12, marginRight: 6 }}>
              {roleLabel[s.role]}:
            </span>
          )}
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  );
}
