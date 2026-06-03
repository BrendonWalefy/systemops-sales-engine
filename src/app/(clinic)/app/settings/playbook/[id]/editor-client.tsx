"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  UserRound,
  X,
} from "lucide-react";
import { updatePlaybookVersion } from "../playbook-version-actions";

type Objection = { objection: string; response: string };
type ChatMessage = { role: "user" | "assistant"; text: string; intent?: string };

type EditorData = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Objection[];
  notes: string;
};

type Props = {
  id: string;
  name: string;
  initialData: EditorData;
  greetingMessage: string;
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
  if (data.procedureDescription.trim()) filled++;
  filled++; // toneOfVoice always has value
  if (data.differentials.filter((d) => d.trim()).length > 0) filled++;
  if (data.commercialPolicy.trim()) filled++;
  if (data.objections.filter((o) => o.objection.trim()).length > 0) filled++;
  return Math.round((filled / 7) * 100);
}

type ObjectionFilter = "all" | "pending";

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
            procedureDescription: data.procedureDescription,
            toneOfVoice: data.toneOfVoice,
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
              fontSize: "13px",
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

// ── Main editor ───────────────────────────────────────────────────────────────

export function PlaybookEditorClient({ id, name, initialData, greetingMessage }: Props) {
  const router = useRouter();
  const [data, setData] = useState<EditorData>(initialData);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedObjectionIndex, setExpandedObjectionIndex] = useState<number | null>(
    initialData.objections.length > 0 ? 0 : null,
  );
  const [objectionQuery, setObjectionQuery] = useState("");
  const [objectionFilter, setObjectionFilter] = useState<ObjectionFilter>("all");
  const [mobileTab, setMobileTab] = useState<"edit" | "test">("edit");
  const versionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerVersionSave = useCallback(
    (newData: EditorData) => {
      if (versionSaveTimer.current) clearTimeout(versionSaveTimer.current);
      setSaved(false);
      versionSaveTimer.current = setTimeout(async () => {
        setSaving(true);
        await updatePlaybookVersion(id, {
          specialty: newData.specialty || null,
          procedureDescription: newData.procedureDescription || null,
          toneOfVoice: newData.toneOfVoice,
          differentials: newData.differentials.filter((d) => d.trim()),
          commercialPolicy: newData.commercialPolicy || null,
          objections: newData.objections.filter((o) => o.objection.trim()),
          notes: newData.notes || null,
        });
        setSaving(false);
        setSaved(true);
      }, 1200);
    },
    [id],
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
        .editor-root { grid-template-rows: auto 1fr auto; }
        .editor-cols { display: grid; grid-template-columns: minmax(0, 1fr) 400px; overflow: hidden; }
        .editor-form-col { overflow-y: auto; padding: 20px 24px 24px; }
        .editor-sim-col { border-left: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; overflow: hidden; }
        .editor-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .editor-sections { display: flex; flex-direction: column; gap: 20px; }
        .objection-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 260px); gap: 10px; align-items: center; }
        .objection-summary { display: flex; flex-wrap: wrap; gap: 8px; }
        .objection-search { position: relative; min-width: 0; }
        .objection-segment { display: flex; width: fit-content; gap: 4px; padding: 4px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.07); background: rgba(15,17,23,0.62); }
        .objection-status { display: inline-flex; align-items: center; flex-shrink: 0; border-radius: 999px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.035); color: #71717a; font-size: 10px; font-weight: 700; padding: 4px 8px; }
        .mobile-tab-bar { display: none; }
        @media (max-width: 820px) {
          .editor-cols { grid-template-columns: 1fr; grid-template-rows: 1fr; }
          .editor-sim-col { border-left: none; border-top: 1px solid rgba(255,255,255,0.07); }
          .editor-config-grid { grid-template-columns: 1fr; }
          .objection-toolbar { grid-template-columns: 1fr; }
          .objection-segment { width: 100%; }
          .objection-segment button { flex: 1; }
          .objection-status { display: none; }
          .mobile-tab-bar { display: flex; }
          .editor-cols.tab-edit .editor-sim-col { display: none; }
          .editor-cols.tab-test .editor-form-col { display: none; }
        }
      `}</style>

      {/* Breadcrumb header */}
      <div style={{
        padding: "14px 24px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>IA</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <button onClick={() => router.push("/app/settings/playbook")} style={crumbBtn}>Playbooks</button>
          <ChevronRight size={12} style={{ color: "#3f3f46" }} />
          <span style={{ fontSize: "12px", color: "#a1a1aa", fontWeight: 500 }}>Editor: {name}</span>
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
                  hint="Ex: nunca pressionar; só oferecer horário com interesse claro; sempre mencionar que os R$100 da avaliação são abatidos; nunca informar preço por mensagem."
                >
                  <textarea
                    value={data.notes}
                    onChange={(e) => updateVersion({ notes: e.target.value })}
                    placeholder={"COMO CONDUZIR A CONVERSA:\n- Acolha, esclareça e conduza com calma. Nunca pressione.\n- Só ofereça agendamento quando o lead demonstrar interesse claro.\n- Sempre mencione o abatimento da avaliação ao falar de valor.\n- NUNCA informe valores de procedimentos por mensagem."}
                    rows={7}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </FieldGroup>
              </EditorSection>

              <EditorSection step="1" title="Contexto base" description="Informações que a IA usa para entender a clínica e o atendimento.">
                <div className="editor-config-grid">
                  <FieldGroup label="Especialidade">
                    <input
                      type="text"
                      value={data.specialty}
                      onChange={(e) => updateVersion({ specialty: e.target.value })}
                      placeholder="Ex: Odontologia Estética e Reabilitação Oral"
                      style={inputStyle}
                    />
                  </FieldGroup>

                  <FieldGroup label="Tom de voz">
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

                <FieldGroup label="Sobre o procedimento">
                  <textarea
                    value={data.procedureDescription}
                    onChange={(e) => updateVersion({ procedureDescription: e.target.value })}
                    placeholder="Descrição do procedimento principal oferecido por esta versão do playbook..."
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </FieldGroup>
              </EditorSection>

              <EditorSection step="2" title="Argumentos da clínica" description="Pontos de diferenciação e regras comerciais que ajudam a conduzir o lead.">
                <FieldGroup label="Diferenciais da clínica">
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {data.differentials.map((diff, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#00d4aa", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}>•</span>
                        <input
                          type="text"
                          value={diff}
                          onChange={(e) => updateDifferential(i, e.target.value)}
                          placeholder="Diferencial..."
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
                </FieldGroup>

                <FieldGroup label="Política comercial">
                  <textarea
                    value={data.commercialPolicy}
                    onChange={(e) => updateVersion({ commercialPolicy: e.target.value })}
                    placeholder="Ex: Avaliação R$100, descontada do tratamento. Parcelamento em até 12x. Nunca informar preços por mensagem."
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical" }}
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
                              placeholder="Como a IA deve responder quando o paciente trouxer essa objeção..."
                              rows={4}
                              style={{ ...inputStyle, resize: "vertical", background: "rgba(9,9,11,0.5)" }}
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
            </div>
          </div>
        </div>

        {/* Right: simulator */}
        <div className="editor-sim-col">
          <SimulatorPanel data={data} greetingMessage={greetingMessage} />
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
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
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: saving ? "#fbbf24" : saved ? "#00d4aa" : "#3f3f46", flexShrink: 0, display: "inline-block" }} />
            {saving ? "Salvando..." : saved ? "Salvo" : "Aguardando"}
          </div>
          <button
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
  fontSize: "14px",
  padding: "10px 14px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
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
