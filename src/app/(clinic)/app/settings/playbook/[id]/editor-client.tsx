"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  UserRound,
  X,
  Film,
  Image as ImageIcon,
  Library,
} from "lucide-react";
import { updatePlaybookVersion } from "../playbook-version-actions";
import { lintPlaybookNotes, lintCommercialPolicy, lintPersonaCoherence } from "@/application/config/playbook-lint";
import type { FieldTarget } from "@/core/intelligence/FieldComposer";
import { useReliableAutosave } from "../use-reliable-autosave";

type Objection = { objection: string; response: string };
type LibraryAsset = { id: string; title: string; type: "video" | "image" | "document" };
type ChatMessage = { role: "user" | "assistant"; text: string; intent?: string };

type EditorData = {
  specialty: string;
  toneOfVoice: string;
  receptionistName: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Objection[];
  notes: string;
  // Seleção de mídias da biblioteca clinic-level (gerenciada em
  // /app/settings/biblioteca) que a IA pode enviar a partir deste playbook.
  mediaAssetIds: string[];
};
type PlaybookVersionPayload = Parameters<typeof updatePlaybookVersion>[1];

type Props = {
  id: string;
  name: string;
  initialData: EditorData;
  greetingMessage: string;
  businessNoun: string;
  bookingNoun: string;
  libraryAssets: LibraryAsset[];
};

const TONES = [
  { value: "acolhedor", label: "Acolhedor" },
  { value: "tecnico", label: "Técnico" },
  { value: "persuasivo", label: "Persuasivo" },
  { value: "luxo", label: "Luxo / Premium" },
];

function completude(data: EditorData): number {
  let filled = 0;
  if (data.notes.trim()) filled++;
  if (data.specialty.trim()) filled++;
  filled++; // toneOfVoice always has value
  if (data.receptionistName.trim() && data.receptionistName !== "Marina") filled++;
  if (data.differentials.filter((d) => d.trim()).length > 0) filled++;
  if (data.commercialPolicy.trim()) filled++;
  if (data.objections.filter((o) => o.objection.trim()).length > 0) filled++;
  return Math.round((filled / 7) * 100);
}

type ObjectionFilter = "all" | "pending";

function parseBulletList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
}

function parseObjectionRewrite(text: string, fallback: Objection): Objection {
  const objectionMatch = text.match(/obje[cç][aã]o:\s*([^\n]+)/i);
  const responseMatch = text.match(/resposta:\s*([\s\S]+)/i);
  return {
    objection: objectionMatch?.[1]?.trim() || fallback.objection,
    response: responseMatch?.[1]?.trim() || text.trim() || fallback.response,
  };
}

function toPlaybookVersionPayload(data: EditorData): PlaybookVersionPayload {
  return {
    specialty: data.specialty || null,
    toneOfVoice: data.toneOfVoice,
    receptionistName: data.receptionistName || "Marina",
    differentials: data.differentials.filter((d) => d.trim()),
    commercialPolicy: data.commercialPolicy || null,
    objections: data.objections.filter((o) => o.objection.trim()),
    notes: data.notes || null,
    mediaAssetIds: data.mediaAssetIds,
  };
}

// ── Simulator Panel ───────────────────────────────────────────────────────────

function SimulatorPanel({ data, greetingMessage }: { data: EditorData; greetingMessage: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 1 ? "smooth" : "auto" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/playbook/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages,
          playbook: {
            specialty: data.specialty,
            toneOfVoice: data.toneOfVoice,
            receptionistName: data.receptionistName || undefined,
            differentials: data.differentials.filter((d) => d.trim()),
            commercialPolicy: data.commercialPolicy,
            objections: data.objections.filter((o) => o.objection.trim()),
            greetingMessage,
            notes: data.notes || null,
          },
        }),
      });
      const json = await res.json();
      setMessages((p) => [
        ...p,
        { role: "assistant", text: json.text ?? "Erro ao obter resposta.", intent: json.intent },
      ]);
    } catch {
      setMessages((p) => [...p, { role: "assistant", text: "Erro de conexão." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Sim header */}
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <FlaskConical size={13} style={{ color: "#00d4aa" }} />
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#a1a1aa" }}>Testar IA (rascunho atual)</span>
        </div>
        {!isEmpty && (
          <button
            type="button"
            onClick={() => { setMessages([]); setInput(""); }}
            title="Reiniciar conversa"
            style={{ background: "transparent", border: "none", color: "#52525b", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 14px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          minHeight: 0,
        }}
      >
        {isEmpty ? (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            color: "#52525b",
            fontSize: "12px",
            textAlign: "center",
            padding: "20px 16px",
          }}>
            <span style={{
              width: "36px", height: "36px", borderRadius: "999px",
              display: "grid", placeItems: "center",
              background: "rgba(0,212,170,0.08)", color: "#00d4aa",
              border: "1px solid rgba(0,212,170,0.16)",
            }}>
              <Bot size={17} />
            </span>
            <span style={{ lineHeight: 1.6, maxWidth: "200px" }}>
              Edite os campos e teste a resposta da IA sem precisar salvar.
            </span>
            {["Quero agendar uma consulta", "Quanto custa a avaliação?"].map((p) => (
              <button key={p} type="button" onClick={() => setInput(p)} style={quickPromptStyle}>
                {p}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => <SimBubble key={i} message={m} />)
        )}
        {loading && <SimBubble message={{ role: "assistant", text: "Digitando..." }} />}
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px 12px", flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Escreva como paciente..."
            rows={2}
            disabled={loading}
            style={{
              flex: 1,
              background: "rgba(15,17,23,0.72)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: "10px",
              color: "#e4e4e7",
              fontSize: "16px",
              padding: "9px 12px",
              outline: "none",
              fontFamily: "inherit",
              resize: "none",
              lineHeight: 1.4,
              opacity: loading ? 0.5 : 1,
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? "#00d4aa" : "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: "10px",
              color: input.trim() && !loading ? "#031f1a" : "#52525b",
              cursor: input.trim() && !loading ? "pointer" : "default",
              height: "44px",
              width: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 150ms",
            }}
          >
            <Send size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SimBubble({ message }: { message: ChatMessage }) {
  const isAI = message.role === "assistant";
  return (
    <div style={{ display: "flex", gap: "7px", alignItems: "flex-start", flexDirection: isAI ? "row-reverse" : "row" }}>
      <span style={{
        width: "22px", height: "22px", borderRadius: "999px", display: "grid", placeItems: "center", flexShrink: 0,
        background: isAI ? "rgba(0,212,170,0.14)" : "rgba(255,255,255,0.06)",
        color: isAI ? "#00d4aa" : "#a1a1aa",
        border: `1px solid ${isAI ? "rgba(0,212,170,0.22)" : "rgba(255,255,255,0.08)"}`,
      }}>
        {isAI ? <Bot size={11} /> : <UserRound size={11} />}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: isAI ? "flex-end" : "flex-start", gap: "3px", flex: 1, minWidth: 0 }}>
        <div style={{
          maxWidth: "85%",
          padding: "8px 11px",
          borderRadius: isAI ? "12px 3px 12px 12px" : "3px 12px 12px 12px",
          background: isAI ? "linear-gradient(135deg, rgba(0,212,170,0.85), rgba(20,184,166,0.6))" : "rgba(255,255,255,0.07)",
          border: `1px solid ${isAI ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.06)"}`,
          color: isAI ? "#ecfdf5" : "#d4d4d8",
          fontSize: "13px",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}>
          {message.text}
        </div>
        {isAI && message.intent && (
          <span style={{
            fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "#00d4aa",
            padding: "2px 6px", background: "rgba(0,212,170,0.09)", borderRadius: "999px",
            border: "1px solid rgba(0,212,170,0.16)",
          }}>
            {message.intent}
          </span>
        )}
      </div>
    </div>
  );
}

const quickPromptStyle: React.CSSProperties = {
  border: "1px solid rgba(0,212,170,0.16)",
  borderRadius: "999px",
  background: "rgba(0,212,170,0.07)",
  color: "#9ffce5",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 600,
  padding: "5px 10px",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function LintWarningsBox({ warnings, title }: { warnings: string[]; title: string }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{
      marginTop: "6px",
      padding: "10px 12px",
      background: "rgba(245,158,11,0.07)",
      border: "1px solid rgba(245,158,11,0.22)",
      borderRadius: "8px",
      display: "flex",
      flexDirection: "column",
      gap: "5px",
    }}>
      <span style={{ fontSize: "10px", fontWeight: 700, color: "#f59e0b", letterSpacing: "0.06em" }}>
        {title}
      </span>
      {warnings.map((w, i) => (
        <span key={i} style={{ fontSize: "11px", color: "#fbbf24", lineHeight: 1.5 }}>• {w}</span>
      ))}
    </div>
  );
}

function NotesLintWarnings({ notes }: { notes: string }) {
  return <LintWarningsBox warnings={lintPlaybookNotes(notes)} title="CONTEÚDO FORA DO LUGAR" />;
}

function CommercialPolicyLintWarnings({ policy }: { policy: string }) {
  return <LintWarningsBox warnings={lintCommercialPolicy(policy)} title="PREÇO TEM CASA NO CADASTRO" />;
}

function PersonaCoherenceLintWarnings({ greetingMessage, receptionistName }: { greetingMessage: string; receptionistName: string }) {
  return (
    <LintWarningsBox
      warnings={lintPersonaCoherence(greetingMessage, receptionistName)}
      title="PERSONA INCONSISTENTE"
    />
  );
}

const OBJECTION_EXAMPLES: Objection[] = [
  {
    objection: "Está muito caro",
    response: "Entendo. O ideal é avaliar seu caso primeiro, porque o valor depende do procedimento indicado. A avaliação é abatida se você iniciar o tratamento.",
  },
  {
    objection: "Quero saber o preço por mensagem",
    response: "Consigo te explicar como funciona, mas valores de procedimento variam conforme o caso. O caminho mais seguro é uma avaliação para indicar o tratamento correto.",
  },
];

// ── Co-writer box ─────────────────────────────────────────────────────────────

type CowriterBoxProps = {
  field: FieldTarget;
  currentValue: string;
  clinicContext: { specialty: string; toneOfVoice: string };
  onApply: (text: string) => void;
  guidedQuestions?: string[];
};

function CowriterBox({ field, currentValue, clinicContext, onApply, guidedQuestions }: CowriterBoxProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"free" | "guided">("free");
  const [userInput, setUserInput] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ proposedText: string; factsUsed: string[]; missingFacts: string[] } | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          background: "rgba(139,92,246,0.08)",
          border: "1px solid rgba(139,92,246,0.2)",
          borderRadius: "8px",
          color: "#a78bfa",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 700,
          padding: "5px 10px",
          marginTop: "6px",
        }}
      >
        <Sparkles size={11} /> Escrever com a IA
      </button>
    );
  }

  async function generate() {
    const input = mode === "guided"
      ? answers.map((a, i) => `${guidedQuestions?.[i] ?? `Pergunta ${i + 1}`}: ${a}`).join("\n")
      : userInput;
    if (!input.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/playbook/advisor/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, userInput: input, currentValue, clinicContext }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({
          proposedText: "",
          factsUsed: [],
          missingFacts: [json.error ?? "Não foi possível gerar a proposta."],
        });
        return;
      }
      setResult({
        proposedText: json.proposedText ?? "",
        factsUsed: Array.isArray(json.factsUsed) ? json.factsUsed : [],
        missingFacts: Array.isArray(json.missingFacts) ? json.missingFacts : [],
      });
    } catch {
      setResult({ proposedText: "", factsUsed: [], missingFacts: ["Erro de conexão. Tente novamente."] });
    } finally {
      setLoading(false);
    }
  }

  function applyAndClose() {
    if (result?.proposedText) {
      onApply(result.proposedText);
      setOpen(false);
      setResult(null);
      setUserInput("");
      setAnswers([]);
    }
  }

  return (
    <div style={{
      marginTop: "8px",
      padding: "14px",
      background: "rgba(139,92,246,0.06)",
      border: "1px solid rgba(139,92,246,0.18)",
      borderRadius: "12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Sparkles size={13} style={{ color: "#a78bfa" }} />
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#a78bfa" }}>Co-escritor de IA</span>
          <span style={{ fontSize: "10px", color: "#71717a" }}>— lapida sem inventar fatos</span>
        </div>
        <button type="button" onClick={() => { setOpen(false); setResult(null); }} style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", padding: "2px" }}>
          <X size={13} />
        </button>
      </div>

      {guidedQuestions && guidedQuestions.length > 0 && (
        <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
          {(["free", "guided"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} style={{
              border: "none", borderRadius: "7px",
              background: mode === m ? "rgba(139,92,246,0.18)" : "transparent",
              color: mode === m ? "#a78bfa" : "#52525b",
              cursor: "pointer", fontSize: "11px", fontWeight: 700, padding: "5px 10px",
            }}>
              {m === "free" ? "Texto livre" : "Perguntas guiadas"}
            </button>
          ))}
        </div>
      )}

      {mode === "free" ? (
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Escreva do seu jeito — a IA lapida o texto mantendo os fatos que você forneceu."
          rows={3}
          style={{ ...inputStyle, resize: "vertical", marginBottom: "8px" }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
          {guidedQuestions?.map((q, i) => (
            <div key={i}>
              <label style={{ fontSize: "11px", color: "#71717a", display: "block", marginBottom: "4px" }}>{q}</label>
              <input
                type="text"
                value={answers[i] ?? ""}
                onChange={(e) => { const next = [...answers]; next[i] = e.target.value; setAnswers(next); }}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      )}

      {result && (result.proposedText || currentValue) && (
        <div className="cowriter-compare" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px", marginBottom: "10px" }}>
          <div style={{ padding: "12px", background: "rgba(0,0,0,0.22)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.07)", minWidth: 0 }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#71717a", marginBottom: "6px", letterSpacing: "0.06em" }}>VALOR ATUAL</div>
            <p style={{ margin: 0, fontSize: "12px", color: "#a1a1aa", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {currentValue.trim() || "Campo vazio."}
            </p>
          </div>
          <div style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid rgba(139,92,246,0.15)", minWidth: 0 }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#a78bfa", marginBottom: "6px", letterSpacing: "0.06em" }}>PROPOSTA EDITÁVEL</div>
            <textarea
              value={result.proposedText}
              onChange={(e) => setResult({ ...result, proposedText: e.target.value })}
              rows={Math.max(4, Math.min(10, result.proposedText.split("\n").length + 1))}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55, background: "rgba(9,9,11,0.5)" }}
            />
          </div>
        </div>
      )}

      {result && result.factsUsed.length > 0 && (
        <div style={{ marginBottom: "10px", padding: "10px 12px", background: "rgba(0,212,170,0.06)", borderRadius: "8px", border: "1px solid rgba(0,212,170,0.14)" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "#00d4aa", marginBottom: "6px", letterSpacing: "0.06em" }}>FATOS USADOS</div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {result.factsUsed.map((f, i) => (
              <li key={i} style={{ fontSize: "12px", color: "#9ffce5", lineHeight: 1.7 }}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.missingFacts.length > 0 && (
        <div style={{ marginBottom: "10px", padding: "10px 12px", background: "rgba(245,158,11,0.07)", borderRadius: "8px", border: "1px solid rgba(245,158,11,0.2)" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "#f59e0b", marginBottom: "6px", letterSpacing: "0.06em" }}>FALTA INFORMAR</div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {result.missingFacts.map((f, i) => (
              <li key={i} style={{ fontSize: "12px", color: "#fbbf24", lineHeight: 1.7 }}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          style={{
            flex: 1,
            background: loading ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.18)",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: "8px",
            color: "#a78bfa",
            cursor: loading ? "default" : "pointer",
            fontSize: "12px",
            fontWeight: 700,
            padding: "8px",
          }}
        >
          {loading ? "Gerando..." : result ? "Regenerar" : "Gerar proposta"}
        </button>
        {result?.proposedText && (
          <button
            type="button"
            onClick={applyAndClose}
            style={{
              flex: 1,
              background: "rgba(0,212,170,0.12)",
              border: "1px solid rgba(0,212,170,0.24)",
              borderRadius: "8px",
              color: "#00d4aa",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 700,
              padding: "8px",
            }}
          >
            Usar este texto
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function PlaybookEditorClient({ id, name, initialData, greetingMessage, businessNoun, libraryAssets }: Props) {
  const router = useRouter();
  const [data, setData] = useState<EditorData>(initialData);
  const { scheduleSave, flush, saving, saved, pending, error } = useReliableAutosave<PlaybookVersionPayload>({
    delayMs: 1200,
    save: (payload) => updatePlaybookVersion(id, payload),
  });
  const [expandedObjectionIndex, setExpandedObjectionIndex] = useState<number | null>(
    initialData.objections.length > 0 ? 0 : null,
  );
  const [objectionQuery, setObjectionQuery] = useState("");
  const [objectionFilter, setObjectionFilter] = useState<ObjectionFilter>("all");
  const [mobileTab, setMobileTab] = useState<"edit" | "test">("edit");

  const triggerVersionSave = useCallback(
    (newData: EditorData) => {
      scheduleSave(toPlaybookVersionPayload(newData));
    },
    [scheduleSave],
  );

  function updateVersion(patch: Partial<EditorData>) {
    setData((prev) => { const next = { ...prev, ...patch }; triggerVersionSave(next); return next; });
  }

  function updateDifferential(index: number, value: string) {
    const next = [...data.differentials]; next[index] = value; updateVersion({ differentials: next });
  }
  function addDifferential() { updateVersion({ differentials: [...data.differentials, ""] }); }
  function removeDifferential(index: number) { updateVersion({ differentials: data.differentials.filter((_, i) => i !== index) }); }

  function updateObjection(index: number, field: keyof Objection, value: string) {
    const next = [...data.objections]; next[index] = { ...next[index], [field]: value }; updateVersion({ objections: next });
  }
  function addObjection() {
    const nextIndex = data.objections.length;
    updateVersion({ objections: [...data.objections, { objection: "", response: "" }] });
    setExpandedObjectionIndex(nextIndex);
  }
  function removeObjection(index: number) {
    const nextObjections = data.objections.filter((_, i) => i !== index);
    updateVersion({ objections: nextObjections });
    setExpandedObjectionIndex((current) => {
      if (nextObjections.length === 0) return null;
      if (current === index) return Math.min(index, nextObjections.length - 1);
      if (current !== null && current > index) return current - 1;
      return current;
    });
  }
  function addObjectionExample(example: Objection) {
    const nextIndex = data.objections.length;
    updateVersion({ objections: [...data.objections, example] });
    setExpandedObjectionIndex(nextIndex);
  }
  function applyObjectionRewrite(index: number, text: string) {
    const next = [...data.objections];
    next[index] = parseObjectionRewrite(text, next[index]);
    updateVersion({ objections: next });
  }

  function toggleMediaAsset(assetId: string) {
    const next = data.mediaAssetIds.includes(assetId)
      ? data.mediaAssetIds.filter((id) => id !== assetId)
      : [...data.mediaAssetIds, assetId];
    updateVersion({ mediaAssetIds: next });
  }

  const pct = completude(data);
  const completedObjections = data.objections.filter((o) => o.objection.trim() && o.response.trim()).length;
  const pendingObjections = data.objections.filter((o) => o.objection.trim() && !o.response.trim()).length;
  const normalizedObjectionQuery = objectionQuery.trim().toLowerCase();
  const visibleObjections = data.objections
    .map((objection, index) => ({ objection, index }))
    .filter(({ objection }) => {
      const matchesQuery =
        !normalizedObjectionQuery ||
        objection.objection.toLowerCase().includes(normalizedObjectionQuery) ||
        objection.response.toLowerCase().includes(normalizedObjectionQuery);
      const matchesFilter = objectionFilter === "all" || !objection.response.trim();
      return matchesQuery && matchesFilter;
    });

  return (
    <div className="editor-root" style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr auto", overflow: "hidden", background: "var(--background)" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .editor-root {
          grid-template-rows: auto 1fr auto;
          width: 100%;
          max-width: 100vw;
          overflow: hidden;
          -webkit-text-size-adjust: 100%;
        }
        .editor-root *,
        .editor-root *::before,
        .editor-root *::after { box-sizing: border-box; }
        .editor-header { min-width: 0; }
        .editor-crumbs { min-width: 0; overflow: hidden; }
        .editor-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .editor-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); overflow: hidden; min-width: 0; }
        .editor-form-col { overflow-y: auto; overflow-x: hidden; padding: 20px 24px 24px; min-width: 0; }
        .editor-sim-col { border-left: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
        .editor-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .editor-sections { display: flex; flex-direction: column; gap: 20px; }
        .objection-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 260px); gap: 10px; align-items: center; }
        .objection-summary { display: flex; flex-wrap: wrap; gap: 8px; }
        .objection-search { position: relative; min-width: 0; }
        .objection-segment { display: flex; width: fit-content; gap: 4px; padding: 4px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.07); background: rgba(15,17,23,0.62); }
        .objection-status { display: inline-flex; align-items: center; flex-shrink: 0; border-radius: 999px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.035); color: #71717a; font-size: 10px; font-weight: 700; padding: 4px 8px; }
        .mobile-tab-bar { display: none; }
        .editor-root input,
        .editor-root textarea,
        .editor-root select {
          caret-color: #00d4aa;
          min-width: 0;
        }
        .editor-root input:focus,
        .editor-root textarea:focus,
        .editor-root select:focus {
          border-color: rgba(0,212,170,0.5) !important;
          box-shadow: 0 0 0 3px rgba(0,212,170,0.12), inset 0 1px 0 rgba(255,255,255,0.035) !important;
        }
        @media (max-width: 820px) {
          .editor-root { height: var(--vh, 100dvh) !important; max-width: 100vw; }
          .editor-header {
            align-items: stretch !important;
            padding:
              calc(env(safe-area-inset-top, 0px) + 14px)
              calc(env(safe-area-inset-right, 0px) + 14px)
              10px
              calc(env(safe-area-inset-left, 0px) + 14px) !important;
          }
          .editor-crumbs { flex: 1 1 auto; }
          .editor-title { max-width: 42vw; }
          .editor-root input,
          .editor-root textarea,
          .editor-root select {
            font-size: 16px !important;
            -webkit-text-size-adjust: 100%;
          }
          .editor-cols { grid-template-columns: 1fr; grid-template-rows: 1fr; }
          .editor-form-col {
            padding:
              16px
              calc(env(safe-area-inset-right, 0px) + 14px)
              16px
              calc(env(safe-area-inset-left, 0px) + 14px);
          }
          .editor-sim-col { border-left: none; border-top: 1px solid rgba(255,255,255,0.07); }
          .editor-config-grid { grid-template-columns: 1fr; }
          .objection-toolbar { grid-template-columns: 1fr; }
          .objection-segment { width: 100%; }
          .objection-segment button { flex: 1; }
          .objection-status { display: none; }
          .mobile-tab-bar { display: flex; }
          .editor-cols.tab-edit .editor-sim-col { display: none; }
          .editor-cols.tab-test .editor-form-col { display: none; }
          .cowriter-compare { grid-template-columns: 1fr !important; }
          .editor-bottom-bar {
            padding:
              10px
              calc(env(safe-area-inset-right, 0px) + 14px)
              calc(env(safe-area-inset-bottom, 0px) + 10px)
              calc(env(safe-area-inset-left, 0px) + 14px) !important;
            gap: 10px !important;
          }
          .editor-bottom-bar > button { padding: 8px 10px !important; }
        }
        @media (max-width: 520px) {
          .editor-header { flex-direction: column; gap: 8px !important; }
          .editor-title { max-width: 100%; }
          .mobile-tab-bar { width: 100%; }
          .mobile-tab-bar button { flex: 1; }
          .editor-bottom-bar { align-items: stretch !important; }
          .editor-bottom-bar > div:last-child { display: none !important; }
        }
      `}</style>

      {/* Breadcrumb header */}
      <div className="editor-header" style={{
        padding: "14px 24px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexShrink: 0,
      }}>
        <div className="editor-crumbs" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>IA</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>Playbooks</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <span className="editor-title" style={{ fontSize: "12px", color: "#a1a1aa", fontWeight: 500 }}>Editor: {name}</span>
        </div>
        {/* Mobile tab switcher */}
        <div className="mobile-tab-bar" style={{ gap: "3px", padding: "3px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(9,9,11,0.6)" }}>
          {(["edit", "test"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMobileTab(t)}
              style={{
                background: mobileTab === t ? "rgba(0,212,170,0.12)" : "transparent",
                border: "none",
                borderRadius: "7px",
                color: mobileTab === t ? "#00d4aa" : "#52525b",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 700,
                padding: "5px 12px",
              }}
            >
              {t === "edit" ? "Editar" : "Testar IA"}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column body */}
      <div className={`editor-cols tab-${mobileTab}`} style={{ minHeight: 0 }}>
        {/* Left: form */}
        <div className="editor-form-col">
          <div style={{ maxWidth: "760px", margin: "0 auto" }}>
            <div style={{ marginBottom: "18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#fafafa" }}>Editor de Playbook</h2>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#71717a" }}>Organize primeiro o contexto, depois os argumentos e por fim as respostas preparadas.</p>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0, border: "1px solid rgba(0,212,170,0.2)", background: "linear-gradient(145deg, rgba(0,212,170,0.12), rgba(0,212,170,0.04))", color: "#00d4aa", borderRadius: "999px", padding: "6px 10px", fontSize: "11px", fontWeight: 700 }}>
                <CheckCircle2 size={12} /> Sincronizado com IA
              </span>
            </div>

            <div className="editor-sections">
              <EditorSection step="0" title="Como a IA deve conduzir a conversa" description="Regras de comportamento que valem em toda resposta — o campo mais importante do playbook.">
                <FieldGroup
                  label="Orientação comportamental"
                  hint="Por que importa: é este campo que chega ao topo do prompt da IA. Sem ele, a IA improvisa as regras de abordagem. Com ele preenchido, você define o tom e os limites de cada resposta."
                >
                  <textarea
                    value={data.notes}
                    onChange={(e) => updateVersion({ notes: e.target.value })}
                    placeholder={"COMO CONDUZIR A CONVERSA:\n- Acolha, esclareça e conduza com calma. Nunca pressione.\n- Só ofereça agendamento quando o lead demonstrar interesse claro — não em toda mensagem.\n- Toda jornada começa pela Avaliação. Sempre mencione o abatimento ao falar de valor.\n- NUNCA informe valores de procedimentos por mensagem.\n- Frases curtas. Uma ideia por mensagem. Caloroso, mas direto."}
                    rows={7}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                  <NotesLintWarnings notes={data.notes} />
                  <CowriterBox
                    field="notes"
                    currentValue={data.notes}
                    clinicContext={{ specialty: data.specialty, toneOfVoice: data.toneOfVoice }}
                    onApply={(text) => updateVersion({ notes: text })}
                    guidedQuestions={[
                      "Deve pressionar o lead para fechar logo?",
                      "Quando oferecer agendamento (só com interesse claro ou sempre)?",
                      "O que sempre mencionar ao falar de avaliação?",
                      "Pode informar preços por mensagem?",
                    ]}
                  />
                </FieldGroup>
              </EditorSection>

              <EditorSection step="1" title="Contexto base" description={`Informações que a IA usa para entender ${businessNoun ? `a ${businessNoun}` : "o negócio"} e o atendimento.`}>
                <div className="editor-config-grid">
                  <FieldGroup label="Especialidade" hint="Aparece no prompt para que a IA responda com vocabulário adequado à área.">
                    <input
                      type="text"
                      value={data.specialty}
                      onChange={(e) => updateVersion({ specialty: e.target.value })}
                      placeholder="Ex: Odontologia Estética e Reabilitação Oral"
                      style={inputStyle}
                    />
                  </FieldGroup>

                  <FieldGroup label="Nome da recepcionista" hint="Nome com que a IA se apresenta ao paciente. Deve coincidir com o nome na saudação automática.">
                    <input
                      type="text"
                      value={data.receptionistName}
                      onChange={(e) => updateVersion({ receptionistName: e.target.value })}
                      placeholder="Ex: Marina"
                      style={inputStyle}
                    />
                    <PersonaCoherenceLintWarnings
                      greetingMessage={greetingMessage}
                      receptionistName={data.receptionistName}
                    />
                  </FieldGroup>

                  <FieldGroup label="Tom de voz" hint="Define a personalidade da IA. Acolhedor é o padrão; Luxo para um posicionamento premium.">
                    <select
                      value={data.toneOfVoice}
                      onChange={(e) => updateVersion({ toneOfVoice: e.target.value })}
                      style={{ ...inputStyle, cursor: "pointer", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "calc(100% - 12px) center" }}
                    >
                      {TONES.map((t) => (
                        <option key={t.value} value={t.value} style={{ background: "#141416" }}>{t.label}</option>
                      ))}
                    </select>
                  </FieldGroup>
                </div>

                {/* Item 4: campo "Sobre os procedimentos" aposentado — a descrição de
                    cada procedimento vive no cadastro do tratamento (aba Conhecimento). */}
              </EditorSection>

              <EditorSection step="2" title={`Argumentos ${businessNoun ? `da ${businessNoun}` : "do negócio"}`} description="Pontos de diferenciação e regras comerciais que ajudam a conduzir o lead.">
                <FieldGroup
                  label={`Diferenciais ${businessNoun ? `da ${businessNoun}` : "do negócio"}`}
                  hint="Por que importa: diferenciais viram argumentos curtos quando o lead está comparando opções. Use fatos verificáveis, não promessa de resultado."
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {data.differentials.map((diff, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#00d4aa", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}>•</span>
                        <input
                          type="text"
                          value={diff}
                          onChange={(e) => updateDifferential(i, e.target.value)}
                          placeholder="Ex: atendimento com especialista, scanner 3D, laboratório próprio"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button type="button" onClick={() => removeDifferential(i)} style={iconBtnStyle}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addDifferential} style={addBtnStyle}>
                      <Plus size={13} /> Adicionar item
                    </button>
                  </div>
                  <CowriterBox
                    field="differentials"
                    currentValue={data.differentials.filter((d) => d.trim()).map((d) => `- ${d}`).join("\n")}
                    clinicContext={{ specialty: data.specialty, toneOfVoice: data.toneOfVoice }}
                    onApply={(text) => updateVersion({ differentials: parseBulletList(text) })}
                    guidedQuestions={[
                      `O que torna ${businessNoun ? `a ${businessNoun}` : "o negócio"} diferente das outras opções?`,
                      "Há tecnologia, estrutura ou especialista que deve aparecer?",
                      "Há algum diferencial que você não quer prometer como resultado garantido?",
                    ]}
                  />
                </FieldGroup>

                <FieldGroup
                  label="Política comercial"
                  hint="Por que importa: enquadramento comercial (parcelamento, condições, quando encaminhar para avaliação). Preço de lista e preço promocional/campanha a IA fala a partir do cadastro (aba Financeiro) — não digite valores em R$ aqui."
                >
                  <textarea
                    value={data.commercialPolicy}
                    onChange={(e) => updateVersion({ commercialPolicy: e.target.value })}
                    placeholder={"Parcelamento em até 12x no cartão.\nAvaliação abatida do tratamento se o paciente avançar.\nNão informar preço de procedimentos por mensagem; explicar que o valor depende da avaliação."}
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                  <CommercialPolicyLintWarnings policy={data.commercialPolicy} />
                  <CowriterBox
                    field="commercialPolicy"
                    currentValue={data.commercialPolicy}
                    clinicContext={{ specialty: data.specialty, toneOfVoice: data.toneOfVoice }}
                    onApply={(text) => updateVersion({ commercialPolicy: text })}
                    guidedQuestions={[
                      "Como cobram a avaliação? Tem desconto no tratamento?",
                      "Tem parcelamento? Em quantas vezes?",
                      "Compartilham preço dos procedimentos por mensagem?",
                    ]}
                  />
                </FieldGroup>
              </EditorSection>

              <EditorSection step="3" title="Objeções e respostas" description="Cada objeção fica em uma linha; abra somente a resposta que estiver editando.">
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="objection-toolbar">
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                      <div className="objection-summary">
                        <MetricPill label="Total" value={data.objections.length} />
                        <MetricPill label="Prontas" value={completedObjections} tone="success" />
                        <MetricPill label="Pendentes" value={pendingObjections} tone={pendingObjections > 0 ? "warning" : "muted"} />
                      </div>
                      <div className="objection-segment" role="group">
                        <button type="button" onClick={() => setObjectionFilter("all")} style={segmentButtonStyle(objectionFilter === "all")}>Todas</button>
                        <button type="button" onClick={() => setObjectionFilter("pending")} style={segmentButtonStyle(objectionFilter === "pending")}>Pendentes</button>
                      </div>
                    </div>
                    <div className="objection-search">
                      <Search size={14} style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: "#71717a", pointerEvents: "none" }} />
                      <input
                        type="search"
                        value={objectionQuery}
                        onChange={(e) => setObjectionQuery(e.target.value)}
                        placeholder="Buscar objeção ou resposta..."
                        style={{ ...inputStyle, paddingLeft: "34px", background: "rgba(15,17,23,0.62)" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: "#52525b", lineHeight: 1.5 }}>
                      Por que importa: respostas preparadas mantêm consistência quando o lead pede preço, desconto ou compara opções.
                    </span>
                    {OBJECTION_EXAMPLES.map((example) => (
                      <button
                        key={example.objection}
                        type="button"
                        onClick={() => addObjectionExample(example)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          border: "1px solid rgba(0,212,170,0.18)",
                          borderRadius: "8px",
                          background: "rgba(0,212,170,0.06)",
                          color: "#9ffce5",
                          cursor: "pointer",
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "6px 9px",
                        }}
                      >
                        <Plus size={11} /> {example.objection}
                      </button>
                    ))}
                  </div>

                  {data.objections.length === 0 && (
                    <div style={{ border: "1px dashed rgba(255,255,255,0.11)", borderRadius: "10px", color: "#71717a", fontSize: "12px", lineHeight: 1.5, padding: "14px", background: "rgba(255,255,255,0.02)" }}>
                      Nenhuma objeção cadastrada ainda.
                    </div>
                  )}

                  {data.objections.length > 0 && visibleObjections.length === 0 && (
                    <div style={{ border: "1px dashed rgba(255,255,255,0.11)", borderRadius: "10px", color: "#71717a", fontSize: "12px", lineHeight: 1.5, padding: "14px", background: "rgba(255,255,255,0.02)" }}>
                      Nenhuma objeção encontrada com esse filtro.
                    </div>
                  )}

                  {visibleObjections.map(({ objection: obj, index: i }) => {
                    const isExpanded = expandedObjectionIndex === i;
                    const hasObjection = obj.objection.trim().length > 0;
                    const hasResponse = obj.response.trim().length > 0;
                    return (
                      <div
                        key={i}
                        style={{ background: isExpanded ? "rgba(0,212,170,0.045)" : "rgba(255,255,255,0.025)", border: `1px solid ${isExpanded ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", padding: "8px", transition: "border-color 150ms, background 150ms" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <button type="button" onClick={() => setExpandedObjectionIndex(isExpanded ? null : i)} aria-label={isExpanded ? "Recolher" : "Expandir"} style={{ width: "34px", height: "34px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", color: "#a1a1aa", display: "grid", placeItems: "center", flexShrink: 0 }}>
                            <ChevronDown size={15} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
                          </button>
                          <span style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", flexShrink: 0, borderRadius: "10px", border: "1px solid rgba(0,212,170,0.12)", background: "linear-gradient(145deg, rgba(0,212,170,0.12), rgba(255,255,255,0.025))", color: "#00d4aa", fontSize: "11px", fontWeight: 800 }}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <input
                            type="text"
                            value={obj.objection}
                            onFocus={() => setExpandedObjectionIndex(i)}
                            onChange={(e) => updateObjection(i, "objection", e.target.value)}
                            placeholder="Ex: Está muito caro"
                            style={{ ...inputStyle, flex: 1, minWidth: 0, background: "rgba(9,9,11,0.5)" }}
                          />
                          <span className="objection-status" style={{ color: hasResponse ? "#00d4aa" : "#71717a", borderColor: hasResponse ? "rgba(0,212,170,0.18)" : "rgba(255,255,255,0.07)", background: hasResponse ? "rgba(0,212,170,0.08)" : "rgba(255,255,255,0.035)" }}>
                            {!hasObjection ? "Nova" : hasResponse ? "Resposta pronta" : "Sem resposta"}
                          </span>
                          <button type="button" onClick={() => removeObjection(i)} style={iconBtnStyle}>
                            <X size={13} />
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            <label style={labelStyle}>RESPOSTA PREPARADA DA IA</label>
                            <textarea
                              value={obj.response}
                              onChange={(e) => updateObjection(i, "response", e.target.value)}
                              placeholder={"Ex: Entendo. O valor depende da avaliação e do plano indicado para seu caso. Posso te ajudar a marcar uma avaliação para confirmar o melhor caminho."}
                              rows={4}
                              style={{ ...inputStyle, resize: "vertical", background: "rgba(9,9,11,0.5)" }}
                            />
                            <CowriterBox
                              field="objections"
                              currentValue={`Objeção: ${obj.objection}\nResposta: ${obj.response}`}
                              clinicContext={{ specialty: data.specialty, toneOfVoice: data.toneOfVoice }}
                              onApply={(text) => applyObjectionRewrite(i, text)}
                              guidedQuestions={[
                                "Qual é a objeção do lead, com as palavras dele?",
                                "O que a IA pode afirmar com segurança?",
                                "Quando a IA deve encaminhar para avaliação ou humano?",
                              ]}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button type="button" onClick={addObjection} style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,212,170,0.04)", border: "1px dashed rgba(0,212,170,0.3)", borderRadius: "12px", color: "#00d4aa", cursor: "pointer", fontSize: "13px", fontWeight: 600, padding: "12px", justifyContent: "center" }}>
                    <Plus size={13} /> Adicionar objeção
                  </button>
                </div>
              </EditorSection>

              <EditorSection step="4" title="Mídias que a IA pode enviar" description="Selecione, da biblioteca da clínica, os vídeos e fotos que este playbook autoriza a IA a enviar automaticamente ao lead.">
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {libraryAssets.length === 0 ? (
                    <div style={{ border: "1px dashed rgba(255,255,255,0.11)", borderRadius: "10px", color: "#71717a", fontSize: "12px", lineHeight: 1.5, padding: "14px", background: "rgba(255,255,255,0.02)" }}>
                      Nenhuma mídia na biblioteca ainda.{" "}
                      <Link href="/app/settings/biblioteca" style={{ color: "#00d4aa" }}>
                        Adicionar mídia →
                      </Link>
                    </div>
                  ) : (
                    libraryAssets.map((asset) => {
                      const checked = data.mediaAssetIds.includes(asset.id);
                      return (
                        <label
                          key={asset.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            cursor: "pointer",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            background: checked ? "rgba(0,212,170,0.05)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${checked ? "rgba(0,212,170,0.2)" : "rgba(255,255,255,0.06)"}`,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMediaAsset(asset.id)}
                            style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
                          />
                          {asset.type === "video" ? (
                            <Film size={14} style={{ color: "#60a5fa", flexShrink: 0 }} />
                          ) : (
                            <ImageIcon size={14} style={{ color: "#60a5fa", flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: "13px", color: "#e4e4e7" }}>{asset.title}</span>
                        </label>
                      );
                    })
                  )}

                  <Link
                    href="/app/settings/biblioteca"
                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,212,170,0.04)", border: "1px dashed rgba(0,212,170,0.3)", borderRadius: "12px", color: "#00d4aa", cursor: "pointer", fontSize: "13px", fontWeight: 600, padding: "12px", justifyContent: "center", textDecoration: "none" }}
                  >
                    <Library size={13} /> Gerenciar biblioteca de mídia
                  </Link>
                </div>
              </EditorSection>
            </div>
          </div>
        </div>

        {/* Right: simulator */}
        <div className="editor-sim-col">
          <SimulatorPanel data={data} greetingMessage={greetingMessage} />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="editor-bottom-bar" style={{
        borderTop: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(9,9,11,0.94)",
        backdropFilter: "blur(12px)",
        padding: "11px 24px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        flexShrink: 0,
      }}>
        <button
          onClick={() => router.push("/app/settings/playbook")}
          style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#a1a1aa", fontSize: "13px", fontWeight: 500, cursor: "pointer", padding: "8px 14px", flexShrink: 0 }}
        >
          Voltar
        </button>

        {/* Completude bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#52525b" }}>Completude do Playbook</span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: pct === 100 ? "#00d4aa" : "#a1a1aa" }}>{pct}%</span>
          </div>
          <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#00d4aa", borderRadius: "2px", transition: "width 300ms ease" }} />
          </div>
        </div>

        {/* Save status */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#52525b" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: error ? "#f87171" : saving || pending ? "#fbbf24" : saved ? "#00d4aa" : "#3f3f46", flexShrink: 0, display: "inline-block" }} />
            {error ? "Erro ao salvar" : saving ? "Salvando..." : pending ? "Pendente" : saved ? "Salvo" : "Aguardando"}
          </div>
          <button
            type="button"
            onClick={() => void flush()}
            disabled={saving}
            style={{ padding: "8px 18px", background: saving ? "rgba(0,212,170,0.42)" : "#00d4aa", border: "none", borderRadius: "8px", color: "#031f1a", fontSize: "13px", fontWeight: 700, cursor: saving ? "default" : "pointer", boxShadow: "0 10px 24px rgba(0,212,170,0.14)" }}
          >
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <label style={{ fontSize: "13px", fontWeight: 500, color: "#a1a1aa" }}>{label}</label>
      {children}
      {hint && <p style={{ margin: 0, fontSize: "11px", color: "#52525b", lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

function EditorSection({ step, title, description, children }: { step: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px", border: "1px solid rgba(255,255,255,0.085)", borderRadius: "16px", background: "linear-gradient(145deg, rgba(22,27,39,0.72), rgba(15,17,23,0.6))", boxShadow: "0 18px 55px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)", backdropFilter: "blur(16px)" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <span style={{ width: "24px", height: "24px", borderRadius: "999px", display: "grid", placeItems: "center", flexShrink: 0, background: "rgba(0,212,170,0.12)", color: "#00d4aa", border: "1px solid rgba(0,212,170,0.22)", fontSize: "11px", fontWeight: 800 }}>
          {step}
        </span>
        <div>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#f4f4f5" }}>{title}</h3>
          <p style={{ margin: "3px 0 0", fontSize: "11px", lineHeight: 1.45, color: "#71717a" }}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricPill({ label, value, tone = "muted" }: { label: string; value: number; tone?: "success" | "warning" | "muted" }) {
  const toneStyles = {
    success: { color: "#00d4aa", border: "rgba(0,212,170,0.22)", background: "rgba(0,212,170,0.08)" },
    warning: { color: "#f59e0b", border: "rgba(245,158,11,0.22)", background: "rgba(245,158,11,0.08)" },
    muted: { color: "#a1a1aa", border: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)" },
  }[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: `1px solid ${toneStyles.border}`, background: toneStyles.background, color: toneStyles.color, borderRadius: "999px", padding: "6px 9px", fontSize: "11px", fontWeight: 700 }}>
      <strong style={{ color: "#f4f4f5", fontSize: "12px" }}>{value}</strong>
      {label}
    </span>
  );
}

function segmentButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: "none", borderRadius: "9px",
    background: active ? "rgba(0,212,170,0.12)" : "transparent",
    color: active ? "#00d4aa" : "#71717a",
    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.07)" : "none",
    fontSize: "11px", fontWeight: 700, padding: "7px 10px",
  };
}

const crumbBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#52525b", cursor: "pointer", fontSize: "12px", padding: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(15,17,23,0.72)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "10px",
  color: "#e4e4e7",
  fontSize: "16px",
  padding: "10px 14px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  lineHeight: 1.45,
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 700, color: "#52525b",
  letterSpacing: "0.08em", marginBottom: "6px",
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", color: "#52525b", cursor: "pointer",
  padding: "4px", borderRadius: "4px", display: "flex", alignItems: "center", flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "6px", background: "transparent",
  border: "none", color: "#00d4aa", cursor: "pointer", fontSize: "13px", padding: "4px 0", width: "fit-content",
};
