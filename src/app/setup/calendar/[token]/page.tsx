"use client";

import { useRef, useState, useEffect } from "react";
import { Upload, Check, AlertCircle, Calendar, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function CalendarSetupPage({ params }: { params: { token: string } }) {
  const [clinicName, setClinicName] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Tentar descobrir o nome da clínica fazendo uma requisição prévia
    // (opcional, poderia ser retornado na validação do token)
    const validateToken = async () => {
      try {
        // Apenas verificar se token é válido tentando carregar informações
        // Por enquanto, deixaremos genérico
      } catch {
        // Silenciar erro
      }
    };
    validateToken();
  }, []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/setup/calendar/${params.token}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setClinicName(data.clinicName || "Clínica");
        setImportResult({
          imported: data.imported,
          errors: data.errors || [],
        });
        setStatus("success");
      } else {
        setErrorMessage(data.errors?.[0] || data.error || "Erro ao importar calendário");
        setStatus("error");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro na importação",
      );
      setStatus("error");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, var(--bg) 0%, rgba(79, 172, 254, 0.02) 100%)",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 500,
          background: "var(--surface)",
          borderRadius: 16,
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Calendar size={20} style={{ color: "var(--accent)" }} />
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Importar Calendário
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Faça upload de sua agenda do Google Calendar ou Minha Agenda
          </p>
        </div>

        {/* Content */}
        <div style={{ padding: "24px" }}>
          {status === "idle" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Instruções */}
              <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.1)" }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text)" }}>
                  <strong>Como fazer:</strong>
                </p>
                <ol
                  style={{
                    margin: "8px 0 0",
                    paddingLeft: 20,
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.6,
                  }}
                >
                  <li>Abra seu Google Calendar</li>
                  <li>Clique com direito no calendário desejado</li>
                  <li>Selecione "Configurações"</li>
                  <li>Vá em "Integrar calendário"</li>
                  <li>Copie a URL (termina em .ics)</li>
                  <li>Abra a URL no navegador para baixar</li>
                </ol>
              </div>

              {/* File Upload */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--line)",
                  borderRadius: 12,
                  padding: "32px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "var(--surface-soft)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--accent)";
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(79, 172, 254, 0.03)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "var(--line)";
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--surface-soft)";
                }}
              >
                <Upload
                  size={32}
                  style={{
                    margin: "0 auto 12px",
                    color: "var(--accent)",
                  }}
                />
                <p
                  style={{
                    margin: "0 0 4px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  Selecione arquivo .ics
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  ou arraste aqui
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".ics"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
            </div>
          )}

          {status === "uploading" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "3px solid var(--line)",
                  borderTopColor: "var(--accent)",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 16px",
                }}
              />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                Importando calendário...
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                Isso pode levar alguns segundos
              </p>
            </div>
          )}

          {status === "success" && importResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  padding: "16px",
                  borderRadius: 8,
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Check size={20} style={{ color: "#10b981" }} />
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>
                    Sucesso!
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  {importResult.imported} consultas importadas
                </p>
                {importResult.errors.length > 0 && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    {importResult.errors.length} aviso(s)
                  </p>
                )}
              </div>

              <div
                style={{
                  padding: "12px",
                  borderRadius: 8,
                  background: "var(--surface-soft)",
                  fontSize: 12,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                ✓ Calendário sincronizado. A equipe já pode ver os horários disponíveis.
              </div>

              <Link
                href="/"
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "var(--accent)",
                  color: "white",
                  textDecoration: "none",
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Voltar para home
              </Link>
            </div>
          )}

          {status === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  padding: "16px",
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <AlertCircle
                  size={18}
                  style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }}
                />
                <div>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
                    Erro na importação
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                    {errorMessage}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setStatus("idle");
                  setErrorMessage("");
                  setImportResult(null);
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--surface-soft)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid var(--line)",
            background: "var(--surface-soft)",
            fontSize: 11,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Link válido por 7 dias. Dúvidas? Entre em contato com o administrador.
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
