"use client";

import { useRef, useState } from "react";
import { Upload, Copy, Check, AlertCircle, Calendar } from "lucide-react";
import { generateCalendarImportToken } from "./calendar-import-actions";

interface CalendarImportPanelProps {
  clinicId: string;
}

export function CalendarImportPanel({ clinicId }: CalendarImportPanelProps) {
  const [step, setStep] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [generatingLink, setGeneratingLink] = useState(false);
  const [setupUrl, setSetupUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStep("uploading");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/clinic/${clinicId}/import-calendar`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setImportResult({
          imported: data.imported,
          errors: data.errors || [],
        });
        setStep("success");
      } else {
        setErrorMessage(data.errors?.[0] || "Erro ao importar calendário");
        setStep("error");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro na importação",
      );
      setStep("error");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleGenerateLink = async () => {
    setGeneratingLink(true);
    try {
      const result = await generateCalendarImportToken(clinicId);
      if (result.success && result.url) {
        setSetupUrl(result.url);
        setCopied(false);
      } else {
        setErrorMessage(result.error || "Erro ao gerar link");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao gerar link",
      );
    }
    setGeneratingLink(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(setupUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{
          padding: "11px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface-soft)",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <Calendar size={13} style={{ color: "var(--muted)" }} />
        <p className="eyebrow" style={{ margin: 0 }}>
          Importar Google Calendar
        </p>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Opção 1: Upload Direto */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Opção 1: Upload direto
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: "2px dashed var(--line)",
              borderRadius: 8,
              padding: "20px",
              textAlign: "center",
              cursor: "pointer",
              background: "var(--surface-soft)",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
              (e.currentTarget as HTMLElement).style.background = "rgba(79, 172, 254, 0.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
              (e.currentTarget as HTMLElement).style.background = "var(--surface-soft)";
            }}
          >
            <Upload size={16} style={{ margin: "0 auto 6px", color: "var(--muted)" }} />
            <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600 }}>
              Selecione ou arraste arquivo .ics
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
              Google Calendar, Minha Agenda ou qualquer exportação iCalendar
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics"
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />

          {/* Status Upload */}
          {step === "uploading" && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(59, 130, 246, 0.08)",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                fontSize: 13,
                color: "#3b82f6",
              }}
            >
              Importando...
            </div>
          )}

          {step === "success" && importResult && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Check size={14} style={{ color: "#10b981" }} />
                <span style={{ fontWeight: 600, color: "#10b981" }}>
                  ✓ {importResult.imported} consultas importadas
                </span>
              </div>
              {importResult.errors.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {importResult.errors.length} aviso(s): {importResult.errors[0]}
                </div>
              )}
            </div>
          )}

          {step === "error" && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#ef4444",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <AlertCircle size={14} />
              {errorMessage}
            </div>
          )}
        </div>

        {/* Separador */}
        <div
          style={{
            height: 1,
            background: "var(--line)",
            margin: "8px 0",
          }}
        />

        {/* Opção 2: Link de Setup */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Opção 2: Link para recepcionista
          </label>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
            Gere um link único para enviar à recepcionista via WhatsApp/Email
          </p>

          {!setupUrl ? (
            <button
              onClick={handleGenerateLink}
              disabled={generatingLink}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-soft)",
                fontSize: 13,
                fontWeight: 600,
                cursor: generatingLink ? "default" : "pointer",
                opacity: generatingLink ? 0.6 : 1,
              }}
            >
              {generatingLink ? "Gerando..." : "Gerar Link (válido 7 dias)"}
            </button>
          ) : (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--surface-soft)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                type="text"
                value={setupUrl}
                readOnly
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  fontSize: 12,
                  fontFamily: "monospace",
                  color: "var(--text-soft)",
                }}
              />
              <button
                onClick={handleCopyLink}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--line)",
                  background: "var(--accent)",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
