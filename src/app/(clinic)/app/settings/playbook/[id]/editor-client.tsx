"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Send, Trash2, ChevronRight, GripVertical } from "lucide-react";
import { updatePlaybookVersion, updateClinicOperationalSettings } from "../playbook-version-actions";

type Objection = { objection: string; response: string };

type EditorData = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Objection[];
  businessHours: string;
  takeoverTtlHours: number;
  postAppointmentBufferMinutes: number;
  greetingMessage: string;
};

type Props = {
  id: string;
  name: string;
  initialData: EditorData;
};

const TONES = [
  { value: "acolhedor", label: "Acolhedor" },
  { value: "tecnico", label: "Técnico" },
  { value: "persuasivo", label: "Persuasivo" },
  { value: "luxo", label: "Luxo / Premium" },
];

function completude(data: EditorData): number {
  let filled = 0;
  if (data.specialty.trim()) filled++;
  if (data.procedureDescription.trim()) filled++;
  filled++; // toneOfVoice always has value
  if (data.differentials.filter((d) => d.trim()).length > 0) filled++;
  if (data.commercialPolicy.trim()) filled++;
  if (data.objections.filter((o) => o.objection.trim()).length > 0) filled++;
  return Math.round((filled / 6) * 100);
}

type ChatMessage = { role: "user" | "assistant"; text: string; intent?: string };

function PlaybookSandbox({ data }: { data: EditorData }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
            differentials: data.differentials,
            commercialPolicy: data.commercialPolicy,
            greetingMessage: data.greetingMessage,
          },
        }),
      });
      const json = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: json.text ?? "Erro ao obter resposta.", intent: json.intent }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Erro de conexão." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ background: "#0d0d0f", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#71717a" }}>Testar Playbook</p>
          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#3f3f46" }}>Simula respostas com a config atual</p>
        </div>
        {!isEmpty && (
          <button onClick={() => setMessages([])} title="Limpar conversa" style={{ background: "transparent", border: "none", color: "#52525b", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "flex", alignItems: "center" }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div style={{ padding: "12px", minHeight: "160px", maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
        {isEmpty ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#3f3f46", fontSize: "12px", textAlign: "center", padding: "20px 0" }}>
            Digite uma mensagem para ver como a IA responderia
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: "3px" }}>
              <div style={{ maxWidth: "85%", padding: "8px 11px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: m.role === "user" ? "#10b981" : "rgba(255,255,255,0.06)", color: m.role === "user" ? "#fff" : "#d4d4d8", fontSize: "12px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {m.text}
              </div>
              {m.role === "assistant" && m.intent && (
                <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.07em", color: "#3f3f46", padding: "1px 6px", background: "rgba(255,255,255,0.03)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {m.intent}
                </span>
              )}
            </div>
          ))
        )}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "8px 12px", borderRadius: "12px 12px 12px 2px", background: "rgba(255,255,255,0.06)", color: "#52525b", fontSize: "12px", letterSpacing: "0.1em" }}>•••</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Enter test message..."
          rows={1}
          disabled={loading}
          style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", color: "#e4e4e7", fontSize: "12px", padding: "8px 10px", outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.5, opacity: loading ? 0.5 : 1 }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{ background: input.trim() && !loading ? "#10b981" : "rgba(255,255,255,0.05)", border: "none", borderRadius: "8px", color: input.trim() && !loading ? "#fff" : "#52525b", cursor: input.trim() && !loading ? "pointer" : "default", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 150ms" }}
        >
          <Send size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export function PlaybookEditorClient({ id, name, initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState<EditorData>(initialData);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const versionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clinicSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        });
        setSaving(false);
        setSaved(true);
      }, 1200);
    },
    [id],
  );

  const triggerClinicSave = useCallback((newData: EditorData) => {
    if (clinicSaveTimer.current) clearTimeout(clinicSaveTimer.current);
    clinicSaveTimer.current = setTimeout(async () => {
      await updateClinicOperationalSettings({
        businessHours: newData.businessHours || null,
        takeoverTtlHours: newData.takeoverTtlHours,
        postAppointmentBufferMinutes: newData.postAppointmentBufferMinutes,
        greetingMessage: newData.greetingMessage || null,
      });
    }, 1200);
  }, []);

  function updateVersion(patch: Partial<EditorData>) {
    setData((prev) => { const next = { ...prev, ...patch }; triggerVersionSave(next); return next; });
  }

  function updateClinic(patch: Partial<EditorData>) {
    setData((prev) => { const next = { ...prev, ...patch }; triggerClinicSave(next); return next; });
  }

  function updateDifferential(index: number, value: string) {
    const next = [...data.differentials]; next[index] = value; updateVersion({ differentials: next });
  }
  function addDifferential() { updateVersion({ differentials: [...data.differentials, ""] }); }
  function removeDifferential(index: number) { updateVersion({ differentials: data.differentials.filter((_, i) => i !== index) }); }

  function updateObjection(index: number, field: keyof Objection, value: string) {
    const next = [...data.objections]; next[index] = { ...next[index], [field]: value }; updateVersion({ objections: next });
  }
  function addObjection() { updateVersion({ objections: [...data.objections, { objection: "", response: "" }] }); }
  function removeObjection(index: number) { updateVersion({ objections: data.objections.filter((_, i) => i !== index) }); }

  const pct = completude(data);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column" }}>
      <style>{`
        .editor-body { display: grid; grid-template-columns: 1fr 340px; gap: 28px; padding: 24px 28px 100px; align-items: start; }
        .editor-right { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 14px; }
        .editor-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .editor-breadcrumb { padding: 16px 28px 14px; }
        .editor-bottom-bar { padding: 12px 28px; gap: 20px; }
        .editor-bottom-voltar { display: flex; }
        @media (max-width: 640px) {
          .editor-body { grid-template-columns: 1fr; padding: 16px 16px 110px; gap: 16px; }
          .editor-right { position: static; }
          .editor-config-grid { grid-template-columns: 1fr; }
          .editor-breadcrumb { padding: 12px 16px 10px; }
          .editor-bottom-bar { padding: 10px 16px; gap: 10px; }
          .editor-bottom-voltar { display: none; }
        }
      `}</style>
      {/* Breadcrumb header */}
      <div className="editor-breadcrumb" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "6px" }}>
        <button
          onClick={() => router.push("/app/settings/playbook")}
          style={{ background: "transparent", border: "none", color: "#52525b", cursor: "pointer", fontSize: "12px", padding: 0, display: "flex", alignItems: "center" }}
        >
          IA
        </button>
        <ChevronRight size={12} style={{ color: "#3f3f46" }} />
        <button
          onClick={() => router.push("/app/settings/playbook")}
          style={{ background: "transparent", border: "none", color: "#52525b", cursor: "pointer", fontSize: "12px", padding: 0 }}
        >
          Playbooks
        </button>
        <ChevronRight size={12} style={{ color: "#3f3f46" }} />
        <span style={{ fontSize: "12px", color: "#a1a1aa", fontWeight: 500 }}>Editor: {name}</span>
      </div>

      {/* Body: 2 columns */}
      <div className="editor-body" style={{ flex: 1, overflowY: "auto" }}>
        {/* Left — fields */}
        <div>
          <h2 style={{ margin: "0 0 20px", fontSize: "18px", fontWeight: 700, color: "#fafafa" }}>Editor de Playbook</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            <FieldGroup label="Especialidade">
              <input
                type="text"
                value={data.specialty}
                onChange={(e) => updateVersion({ specialty: e.target.value })}
                placeholder="Ex: Odontologia Estética e Reabilitação Oral"
                style={inputStyle}
              />
            </FieldGroup>

            <FieldGroup label="Sobre o procedimento">
              <textarea
                value={data.procedureDescription}
                onChange={(e) => updateVersion({ procedureDescription: e.target.value })}
                placeholder="Descrição do procedimento principal oferecido por esta versão do playbook..."
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
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

            <FieldGroup label="Diferenciais da clínica">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.differentials.map((diff, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: "#10b981", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}>•</span>
                    <input
                      type="text"
                      value={diff}
                      onChange={(e) => updateDifferential(i, e.target.value)}
                      placeholder="Diferencial..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button onClick={() => removeDifferential(i)} style={iconBtnStyle}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={addDifferential} style={addBtnStyle}>
                  <Plus size={13} /> Adicionar item
                </button>
              </div>
            </FieldGroup>

            <FieldGroup label="Política comercial">
              <textarea
                value={data.commercialPolicy}
                onChange={(e) => updateVersion({ commercialPolicy: e.target.value })}
                placeholder="Ex: Avaliação inicial gratuita. Valor da avaliação descontado do tratamento. Parcelamento em até 12x."
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </FieldGroup>

            <FieldGroup label="Objeções e respostas">
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {data.objections.map((obj, i) => (
                  <div
                    key={i}
                    style={{ background: "#0a0a0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "14px 14px 14px 10px", position: "relative", display: "flex", gap: "10px" }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", paddingTop: "2px", color: "#3f3f46", cursor: "grab" }}>
                      <GripVertical size={14} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>OBJEÇÃO DO PACIENTE</label>
                      <textarea
                        value={obj.objection}
                        onChange={(e) => updateObjection(i, "objection", e.target.value)}
                        placeholder="Ex: Está muito caro, não tenho esse valor agora."
                        rows={2}
                        style={{ ...inputStyle, marginBottom: "10px", resize: "vertical" }}
                      />
                      <label style={labelStyle}>RESPOSTA PREPARADA DA IA</label>
                      <textarea
                        value={obj.response}
                        onChange={(e) => updateObjection(i, "response", e.target.value)}
                        placeholder="Como a IA deve responder..."
                        rows={2}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                    </div>
                    <button onClick={() => removeObjection(i)} style={{ ...iconBtnStyle, alignSelf: "flex-start", marginTop: "-2px" }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addObjection}
                  style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "10px", color: "#52525b", cursor: "pointer", fontSize: "13px", padding: "12px", justifyContent: "center" }}
                >
                  <Plus size={13} /> Adicionar objeção
                </button>
              </div>
            </FieldGroup>

            {/* Configs da clínica (separadas visualmente) */}
            <div style={{ height: "1px", background: "rgba(255,255,255,0.05)" }} />

            <FieldGroup label="Saudação inicial" hint="Mensagem enviada quando o lead inicia o contato. Se vazia, a IA gera automaticamente.">
              <textarea
                value={data.greetingMessage}
                onChange={(e) => updateClinic({ greetingMessage: e.target.value })}
                placeholder="Ex: Olá! Sou a assistente virtual da Ximendes Odontologia. Como posso te ajudar hoje?"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </FieldGroup>

            <FieldGroup label="Horário de funcionamento" hint="Usado pela IA para informar leads e para a lógica de agendamento.">
              <input
                type="text"
                value={data.businessHours}
                onChange={(e) => updateClinic({ businessHours: e.target.value })}
                placeholder="Ex: Segunda a sexta das 8h às 18h. Sábado das 8h às 13h."
                style={inputStyle}
              />
            </FieldGroup>

            <div className="editor-config-grid" style={{ display: "grid" }}>
              <FieldGroup label="Pausa automática" hint="Horas até a IA retomar após atendimento humano.">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="number"
                    value={data.takeoverTtlHours}
                    min={0} max={72}
                    onChange={(e) => updateClinic({ takeoverTtlHours: parseInt(e.target.value) || 0 })}
                    style={{ ...inputStyle, width: "80px" }}
                  />
                  <span style={{ fontSize: "13px", color: "#52525b" }}>horas</span>
                </div>
              </FieldGroup>

              <FieldGroup label="Intervalo entre atendimentos" hint="Buffer de tempo após cada agendamento.">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="number"
                    value={data.postAppointmentBufferMinutes}
                    min={0} max={240} step={5}
                    onChange={(e) => updateClinic({ postAppointmentBufferMinutes: parseInt(e.target.value) || 0 })}
                    style={{ ...inputStyle, width: "80px" }}
                  />
                  <span style={{ fontSize: "13px", color: "#52525b" }}>min</span>
                </div>
              </FieldGroup>
            </div>
          </div>
        </div>

        {/* Right panel — sticky on desktop, inline on mobile */}
        <div className="editor-right">
          <PlaybookSandbox data={data} />
        </div>
      </div>

      {/* Bottom bar — fixed */}
      <div
        className="editor-bottom-bar"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: "rgba(9,9,11,0.92)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => router.push("/app/settings/playbook")}
          className="editor-bottom-voltar"
          style={{ alignItems: "center", gap: "6px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#a1a1aa", fontSize: "13px", fontWeight: 500, cursor: "pointer", padding: "9px 16px", flexShrink: 0 }}
        >
          Voltar para Versões
        </button>

        {/* Completude bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#52525b" }}>Completude do Playbook</span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: pct === 100 ? "#34d399" : "#a1a1aa" }}>{pct}%</span>
          </div>
          <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#10b981", borderRadius: "2px", transition: "width 300ms ease" }} />
          </div>
        </div>

        {/* Save status + button */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#52525b" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: saving ? "#fbbf24" : saved ? "#10b981" : "#3f3f46", flexShrink: 0, display: "inline-block" }} />
            {saving ? "Salvando..." : saved ? "Salvo" : "Aguardando"}
          </div>
          <button
            disabled={saving}
            style={{ padding: "9px 20px", background: saving ? "rgba(16,185,129,0.5)" : "#10b981", border: "none", borderRadius: "8px", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: saving ? "default" : "pointer" }}
          >
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <label style={{ fontSize: "13px", fontWeight: 500, color: "#a1a1aa" }}>{label}</label>
      {children}
      {hint && <p style={{ margin: 0, fontSize: "11px", color: "#52525b", lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "8px",
  color: "#e4e4e7",
  fontSize: "14px",
  padding: "10px 14px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "10px",
  fontWeight: 700,
  color: "#52525b",
  letterSpacing: "0.08em",
  marginBottom: "6px",
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#52525b",
  cursor: "pointer",
  padding: "4px",
  borderRadius: "4px",
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  background: "transparent",
  border: "none",
  color: "#10b981",
  cursor: "pointer",
  fontSize: "13px",
  padding: "4px 0",
  width: "fit-content",
};
