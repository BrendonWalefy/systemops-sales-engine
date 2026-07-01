"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Building2, Check, Loader2 } from "lucide-react";
import { createProspectClinic, type ProspectState } from "./actions";

const ESPECIALIDADES = [
  { value: "odontologia", label: "Odontologia" },
  { value: "estetica", label: "Estética" },
  { value: "dermatologia", label: "Dermatologia" },
  { value: "fisioterapia", label: "Fisioterapia" },
  { value: "psicologia", label: "Psicologia" },
  { value: "nutricao", label: "Nutrição" },
  { value: "outro", label: "Outro" },
];

const PLANOS = [
  { value: "essencial", label: "Essencial", price: "R$ 897/mês", desc: "Até 150 leads/mês" },
  { value: "avancado", label: "Clínica", price: "R$ 1.497/mês", desc: "Leads ilimitados", recommended: true },
  { value: "rede", label: "Rede", price: "R$ 2.997/mês", desc: "Até 3 unidades" },
];

const initialState: ProspectState = { ok: false };

export default function NovoDiagnosticoPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [state, formAction, isPending] = useActionState(createProspectClinic, initialState);

  const [name, setName] = useState("");
  const [especialidade, setEspecialidade] = useState("odontologia");
  const [cidade, setCidade] = useState("");
  const [plano, setPlano] = useState("avancado");

  function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setStep(2);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "var(--fg)",
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--muted)",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--background)",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--background)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/owner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <ArrowLeft size={14} />
          Painel owner
        </Link>

        {/* Step indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 800,
              background: "#10b981",
              color: "#000",
            }}
          >
            {step > 1 ? <Check size={14} /> : "1"}
          </div>
          <div
            style={{
              width: 24,
              height: 2,
              borderRadius: 1,
              background: step > 1 ? "#10b981" : "rgba(255,255,255,0.1)",
            }}
          />
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 800,
              background: step === 2 ? "#10b981" : "rgba(255,255,255,0.1)",
              color: step === 2 ? "#000" : "var(--muted)",
            }}
          >
            2
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "28px 20px 120px" }}>
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "rgba(16,185,129,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#10b981",
              marginBottom: 16,
            }}
          >
            <Building2 size={20} />
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "var(--fg)" }}>
            {step === 1 ? "Diagnóstico rápido" : "Acesso da organização"}
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
            {step === 1
              ? "Preencha o essencial durante a reunião — o resto configura depois."
              : "Crie as credenciais de acesso para o admin da organização."}
          </p>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <form onSubmit={handleNext} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={labelStyle}>Nome da organização *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Clínica Ximendes"
                required
                style={inputStyle}
                autoFocus
              />
            </div>

            <div>
              <label style={labelStyle}>Especialidade</label>
              <select
                value={especialidade}
                onChange={(e) => setEspecialidade(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {ESPECIALIDADES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Cidade</label>
              <input
                type="text"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Ex: São Paulo"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Plano</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {PLANOS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlano(p.value)}
                    style={{
                      flex: 1,
                      minWidth: 120,
                      padding: "14px 12px",
                      borderRadius: 12,
                      border:
                        plano === p.value
                          ? "2px solid #10b981"
                          : "1px solid rgba(255,255,255,0.1)",
                      background:
                        plano === p.value
                          ? "rgba(16,185,129,0.08)"
                          : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: plano === p.value ? "#10b981" : "var(--fg)",
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "var(--fg)",
                        marginTop: 4,
                      }}
                    >
                      {p.price}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {p.desc}
                    </div>
                    {p.recommended && plano === p.value && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#10b981",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Recomendado
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              style={{
                marginTop: 8,
                width: "100%",
                minHeight: 52,
                borderRadius: 14,
                border: "none",
                background: "#10b981",
                color: "#000",
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              Próximo
              <ChevronRight size={18} />
            </button>
          </form>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <form
            action={formAction}
            style={{ display: "flex", flexDirection: "column", gap: 20 }}
          >
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="specialty" value={especialidade} />
            <input type="hidden" name="city" value={cidade} />
            <input type="hidden" name="plan" value={plano} />
            {/* Resumo read-only */}
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid rgba(16,185,129,0.2)",
                background: "rgba(16,185,129,0.04)",
              }}
            >
              <p className="eyebrow" style={{ margin: "0 0 8px", color: "#10b981" }}>
                Resumo do cadastro
              </p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
                {name}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
                {ESPECIALIDADES.find((e) => e.value === especialidade)?.label}
                {cidade ? ` · ${cidade}` : ""}
                {" · "}
                {PLANOS.find((p) => p.value === plano)?.price}
              </p>
            </div>

            <div>
              <label style={labelStyle}>Email do admin *</label>
              <input
                type="email"
                name="adminEmail"
                placeholder="admin@clinica.com"
                required
                style={inputStyle}
                autoFocus
              />
              {state.errors?.adminEmail && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#f87171" }}>
                  {state.errors.adminEmail}
                </p>
              )}
            </div>

            <div>
              <label style={labelStyle}>Senha de acesso *</label>
              <input
                type="password"
                name="adminPassword"
                placeholder="Mínimo 8 caracteres"
                required
                minLength={8}
                style={inputStyle}
              />
              {state.errors?.adminPassword && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#f87171" }}>
                  {state.errors.adminPassword}
                </p>
              )}
            </div>

            {state.message && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "rgba(248,113,113,0.1)",
                  border: "1px solid rgba(248,113,113,0.25)",
                  color: "#f87171",
                  fontSize: 13,
                }}
              >
                {state.message}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  flex: "0 0 auto",
                  padding: "0 20px",
                  minHeight: 52,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: "var(--muted)",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <ArrowLeft size={16} />
                Voltar
              </button>

              <button
                type="submit"
                disabled={isPending}
                style={{
                  flex: 1,
                  minHeight: 52,
                  borderRadius: 14,
                  border: "none",
                  background: isPending ? "rgba(16,185,129,0.5)" : "#10b981",
                  color: "#000",
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: isPending ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 0.15s",
                }}
              >
                {isPending ? (
                  <>
                    <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                    Criando...
                  </>
                ) : (
                  <>
                    Criar pré-cadastro
                    <ChevronRight size={18} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input::placeholder, select option { color: var(--muted); }
      `}</style>
    </div>
  );
}
