"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ChevronLeft, RefreshCw } from "lucide-react";
import { updatePlaybookVersion, updateClinicOperationalSettings, createPlaybookVersion } from "../playbook-version-actions";

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
};

type Props = {
  id: string;
  name: string;
  initialData: EditorData;
};

const TONES = [
  { value: "acolhedor", label: "ACOLHEDOR" },
  { value: "tecnico", label: "TÉCNICO" },
  { value: "persuasivo", label: "PERSUASIVO" },
  { value: "luxo", label: "LUXO" },
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

function AIPreview({ data, regenerateKey }: { data: EditorData; regenerateKey: number }) {
  const specialty = data.specialty.trim() || "sua especialidade";
  const hours = data.businessHours.trim() || "horário comercial";
  const toneLabels: Record<string, string> = {
    acolhedor: "acolhedor",
    tecnico: "técnico e objetivo",
    persuasivo: "persuasivo",
    luxo: "exclusivo",
  };
  const tone = toneLabels[data.toneOfVoice] ?? data.toneOfVoice;

  return (
    <div
      key={regenerateKey}
      style={{
        fontFamily: "monospace",
        fontSize: "12px",
        lineHeight: 1.8,
        color: "#71717a",
        whiteSpace: "pre-wrap",
        animation: "fadeIn 300ms ease",
      }}
    >
      {"Olá! Sou o assistente da clínica.\nSobre "}
      <span style={{ color: "#34d399" }}>{specialty}</span>
      {" — atendemos no\nhorário "}
      <span style={{ color: "#34d399" }}>{hours}</span>
      {" com tom\n"}
      <span style={{ color: "#34d399" }}>{tone}</span>
      {". Posso te ajudar a agendar\numa avaliação?"}
    </div>
  );
}

export function PlaybookEditorClient({ id, name, initialData }: Props) {
  const router = useRouter();
  const [data, setData] = useState<EditorData>(initialData);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [regenerateKey, setRegenerateKey] = useState(0);
  const [creatingNew, setCreatingNew] = useState(false);
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
      });
    }, 1200);
  }, []);

  function updateVersion(patch: Partial<EditorData>) {
    setData((prev) => {
      const next = { ...prev, ...patch };
      triggerVersionSave(next);
      return next;
    });
  }

  function updateClinic(patch: Partial<EditorData>) {
    setData((prev) => {
      const next = { ...prev, ...patch };
      triggerClinicSave(next);
      return next;
    });
  }

  function updateDifferential(index: number, value: string) {
    const next = [...data.differentials];
    next[index] = value;
    updateVersion({ differentials: next });
  }

  function addDifferential() {
    updateVersion({ differentials: [...data.differentials, ""] });
  }

  function removeDifferential(index: number) {
    updateVersion({ differentials: data.differentials.filter((_, i) => i !== index) });
  }

  function updateObjection(index: number, field: keyof Objection, value: string) {
    const next = [...data.objections];
    next[index] = { ...next[index], [field]: value };
    updateVersion({ objections: next });
  }

  function addObjection() {
    updateVersion({ objections: [...data.objections, { objection: "", response: "" }] });
  }

  function removeObjection(index: number) {
    updateVersion({ objections: data.objections.filter((_, i) => i !== index) });
  }

  async function handleNewPlaybook() {
    setCreatingNew(true);
    const nome = prompt("Nome do novo playbook:");
    if (!nome?.trim()) { setCreatingNew(false); return; }
    await createPlaybookVersion(nome.trim());
  }

  const pct = completude(data);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* Header */}
      <div
        style={{
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--background)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => router.push("/app/settings/playbook")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "transparent",
              border: "none",
              color: "#71717a",
              cursor: "pointer",
              fontSize: "14px",
              padding: "6px 0",
            }}
          >
            <ChevronLeft size={16} />
            Voltar
          </button>
          <div style={{ width: "1px", height: "18px", background: "rgba(255,255,255,0.08)" }} />
          <span style={{ fontSize: "15px", fontWeight: 600, color: "#fafafa" }}>{name}</span>
        </div>
        <button
          onClick={handleNewPlaybook}
          disabled={creatingNew}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "9px 18px",
            background: "#10b981",
            border: "none",
            borderRadius: "9px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={14} strokeWidth={2.5} />
          Novo Playbook
        </button>
      </div>

      {/* Breadcrumb */}
      <div style={{ padding: "12px 28px", fontSize: "12px", color: "#52525b" }}>
        <span
          onClick={() => router.push("/app/settings/playbook")}
          style={{ cursor: "pointer", color: "#71717a" }}
        >
          Playbooks
        </span>
        {" / "}
        <span>{name}</span>
      </div>

      {/* Body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: "32px",
          padding: "0 28px 40px",
          alignItems: "start",
        }}
      >
        {/* Sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Section number="01" title="Especialidade">
            <input
              type="text"
              value={data.specialty}
              onChange={(e) => updateVersion({ specialty: e.target.value })}
              placeholder="Ex: Odontologia Estética e Reabilitação Oral"
              style={inputStyle}
            />
          </Section>

          <Section number="02" title="Sobre o procedimento">
            <textarea
              value={data.procedureDescription}
              onChange={(e) => updateVersion({ procedureDescription: e.target.value })}
              placeholder="Descreva o procedimento principal oferecido por esta versão do playbook..."
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Section>

          <Section number="03" title="Tom de voz">
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {TONES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => updateVersion({ toneOfVoice: t.value })}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "999px",
                    border: "1px solid",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    cursor: "pointer",
                    transition: "all 150ms",
                    ...(data.toneOfVoice === t.value
                      ? { background: "#10b981", borderColor: "#10b981", color: "#fff" }
                      : { background: "transparent", borderColor: "rgba(255,255,255,0.12)", color: "#71717a" }),
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          <Section number="04" title="Diferenciais da Clínica">
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {data.differentials.map((diff, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ color: "#10b981", fontSize: "18px", lineHeight: 1 }}>•</span>
                  <input
                    type="text"
                    value={diff}
                    onChange={(e) => updateDifferential(i, e.target.value)}
                    placeholder="Diferencial..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={() => removeDifferential(i)} style={iconBtnStyle}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button onClick={addDifferential} style={addBtnStyle}>
                <Plus size={14} /> Adicionar item
              </button>
            </div>
          </Section>

          <Section number="05" title="Política comercial">
            <textarea
              value={data.commercialPolicy}
              onChange={(e) => updateVersion({ commercialPolicy: e.target.value })}
              placeholder="Ex: Avaliação inicial gratuita. Valor da avaliação descontado do tratamento. Parcelamento em até 12x."
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Section>

          <Section number="06" title="Objeções e respostas">
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {data.objections.map((obj, i) => (
                <div
                  key={i}
                  style={{
                    background: "#0a0a0c",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: "10px",
                    padding: "16px",
                    position: "relative",
                  }}
                >
                  <button onClick={() => removeObjection(i)} style={{ ...iconBtnStyle, position: "absolute", top: "12px", right: "12px" }}>
                    <X size={14} />
                  </button>
                  <label style={labelStyle}>OBJEÇÃO</label>
                  <textarea
                    value={obj.objection}
                    onChange={(e) => updateObjection(i, "objection", e.target.value)}
                    placeholder="Ex: Está muito caro, não tenho esse valor agora."
                    rows={2}
                    style={{ ...inputStyle, marginBottom: "12px", resize: "vertical" }}
                  />
                  <label style={labelStyle}>RESPOSTA DA IA</label>
                  <textarea
                    value={obj.response}
                    onChange={(e) => updateObjection(i, "response", e.target.value)}
                    placeholder="Como a IA deve responder..."
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>
              ))}
              <button
                onClick={addObjection}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "transparent",
                  border: "1px dashed rgba(255,255,255,0.1)",
                  borderRadius: "10px",
                  color: "#52525b",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: "14px",
                  justifyContent: "center",
                }}
              >
                <Plus size={14} /> Adicionar objeção
              </button>
            </div>
          </Section>

          {/* Seções de configuração da clínica */}
          <Section number="07" title="Horário de funcionamento">
            <input
              type="text"
              value={data.businessHours}
              onChange={(e) => updateClinic({ businessHours: e.target.value })}
              placeholder="Ex: Segunda a sexta das 8h às 18h. Sábado das 8h às 13h."
              style={inputStyle}
            />
            <p style={{ margin: "8px 0 0", fontSize: "11px", color: "#52525b" }}>
              Usado pela IA para informar leads e para a lógica de agendamento.
            </p>
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <Section number="08" title="Pausa automática (horas)">
              <input
                type="number"
                value={data.takeoverTtlHours}
                min={0}
                max={72}
                onChange={(e) =>
                  updateClinic({ takeoverTtlHours: parseInt(e.target.value) || 0 })
                }
                style={{ ...inputStyle, width: "100px" }}
              />
              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "#52525b" }}>
                Tempo até a IA retomar após atendimento humano.
              </p>
            </Section>

            <Section number="09" title="Intervalo entre atendimentos (min)">
              <input
                type="number"
                value={data.postAppointmentBufferMinutes}
                min={0}
                max={240}
                step={5}
                onChange={(e) =>
                  updateClinic({ postAppointmentBufferMinutes: parseInt(e.target.value) || 0 })
                }
                style={{ ...inputStyle, width: "100px" }}
              />
              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "#52525b" }}>
                Buffer de tempo após cada agendamento.
              </p>
            </Section>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ position: "sticky", top: "72px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              background: "#0d0d0f",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "14px",
              padding: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#71717a", letterSpacing: "0.04em" }}>
                Visualização da IA
              </p>
              <button
                onClick={() => setRegenerateKey((k) => k + 1)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "transparent",
                  border: "none",
                  color: "#10b981",
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  padding: "4px 0",
                }}
              >
                <RefreshCw size={11} strokeWidth={2.5} />
                REGENERAR
              </button>
            </div>
            <AIPreview data={data} regenerateKey={regenerateKey} />

            <div style={{ marginTop: "20px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: "#52525b",
                  marginBottom: "8px",
                }}
              >
                <span>Completude</span>
                <span style={{ color: pct === 100 ? "#34d399" : "#71717a", fontWeight: 600 }}>
                  {pct}%
                </span>
              </div>
              <div
                style={{
                  height: "4px",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: "#10b981",
                    borderRadius: "2px",
                    transition: "width 300ms ease",
                  }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push("/app/settings/playbook")}
            style={{ ...outlineBtnStyle, width: "100%", justifyContent: "center" }}
          >
            Voltar para versões
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#52525b" }}>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: saving ? "#fbbf24" : saved ? "#10b981" : "#52525b",
                flexShrink: 0,
              }}
            />
            {saving
              ? "Salvando..."
              : saved
                ? "Alterações salvas automaticamente"
                : "Aguardando alterações"}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#0d0d0f",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "14px",
        padding: "22px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#10b981" }}>{number}</span>
        <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#fafafa" }}>{title}</h3>
      </div>
      {children}
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
  marginBottom: "8px",
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

const outlineBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 16px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#a1a1aa",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
};
