"use client";

import { useState } from "react";
import type { AdvisorResult, PlaybookGap } from "@/core/intelligence/PlaybookAdvisor";

type Props = {
  clinicId: string;
  metricsData: Record<string, unknown>;
  metricsDate: string;
  currentPlaybook: {
    specialty: string;
    toneOfVoice: string;
    differentials: string[];
    commercialPolicy: string;
    objections: Array<{ objection: string; response: string }>;
    greetingMessage: string;
  };
  clinicName: string;
};

type ValidationResult = {
  passed: number;
  total: number;
  failures: Array<{ scenario: string; expectedIntent: string; actualIntent: string }>;
};

const IMPACT_COLORS: Record<PlaybookGap["impactEstimate"], string> = {
  high: "text-red-400 bg-red-400/10 border-red-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  low: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
};

const IMPACT_LABELS: Record<PlaybookGap["impactEstimate"], string> = {
  high: "Alto impacto",
  medium: "Médio impacto",
  low: "Baixo impacto",
};

export function SuggestionsClient({ clinicId, metricsData, metricsDate, currentPlaybook, clinicName }: Props) {
  const [loading, setLoading] = useState(false);
  const [advisorResult, setAdvisorResult] = useState<AdvisorResult | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    setAdvisorResult(null);
    setValidationResult(null);

    try {
      const res = await fetch("/api/playbook/advisor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, metricsData, currentPlaybook }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erro ao analisar");
      }

      const result: AdvisorResult = await res.json();
      setAdvisorResult(result);

      // Validação automática do playbook proposto
      const validateRes = await fetch("/api/playbook/advisor/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedPlaybook: result.proposedPlaybook }),
      });

      if (validateRes.ok) {
        const validation: ValidationResult = await validateRes.json();
        setValidationResult(validation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish() {
    if (!advisorResult || !validationResult) return;
    if (validationResult.passed < validationResult.total) {
      setError(`Não é possível publicar: ${validationResult.total - validationResult.passed} cenário(s) falhando na validação.`);
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch("/api/playbook/advisor/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, proposedPlaybook: advisorResult.proposedPlaybook }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erro ao publicar");
      }

      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  const metricsFormatted = {
    unclear: ((metricsData.unclearRate as number ?? 0) * 100).toFixed(1),
    needsHuman: ((metricsData.needsHumanRate as number ?? 0) * 100).toFixed(1),
    dropOff: ((metricsData.dropOffAfterSlotsRate as number ?? 0) * 100).toFixed(1),
    conversion: ((metricsData.conversionRate as number ?? 0) * 100).toFixed(1),
    total: metricsData.totalConversations as number ?? 0,
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Sugestões de Playbook</h1>
        <p className="text-zinc-400 text-sm mt-1">
          {clinicName} · Métricas de {new Date(metricsDate).toLocaleDateString("pt-BR")}
        </p>
      </div>

      {/* Métricas resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Conversas", value: String(metricsFormatted.total) },
          { label: "Unclear", value: `${metricsFormatted.unclear}%` },
          { label: "Abandono pós-slots", value: `${metricsFormatted.dropOff}%` },
          { label: "Conversão", value: `${metricsFormatted.conversion}%` },
        ].map((m) => (
          <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <p className="text-zinc-500 text-xs">{m.label}</p>
            <p className="text-white font-semibold text-lg mt-1">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Ação */}
      {!advisorResult && (
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg transition"
        >
          {loading ? "Analisando..." : "Analisar e gerar sugestões"}
        </button>
      )}

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Resultado do Advisor */}
      {advisorResult && (
        <div className="space-y-4">
          {/* Reasoning */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <p className="text-zinc-400 text-xs uppercase tracking-wide mb-2">Análise</p>
            <p className="text-zinc-200 text-sm">{advisorResult.reasoning}</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 bg-zinc-800 rounded-full flex-1">
                <div
                  className="h-1.5 bg-emerald-500 rounded-full"
                  style={{ width: `${advisorResult.confidenceScore * 100}%` }}
                />
              </div>
              <span className="text-zinc-400 text-xs whitespace-nowrap">
                {(advisorResult.confidenceScore * 100).toFixed(0)}% confiança
              </span>
            </div>
          </div>

          {/* Gaps */}
          {advisorResult.gaps.length === 0 ? (
            <p className="text-zinc-400 text-sm">Nenhum gap significativo identificado com as métricas atuais.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-zinc-400 text-xs uppercase tracking-wide">
                {advisorResult.gaps.length} gap{advisorResult.gaps.length > 1 ? "s" : ""} identificado{advisorResult.gaps.length > 1 ? "s" : ""}
              </p>
              {advisorResult.gaps.map((gap, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-white text-sm font-medium">{gap.description}</p>
                    <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${IMPACT_COLORS[gap.impactEstimate]}`}>
                      {IMPACT_LABELS[gap.impactEstimate]}
                    </span>
                  </div>
                  <p className="text-zinc-400 text-sm">{gap.suggestion}</p>
                  {gap.evidence.length > 0 && (
                    <div className="pt-1 space-y-1">
                      {gap.evidence.map((e, j) => (
                        <p key={j} className="text-zinc-500 text-xs before:content-['•'] before:mr-1.5">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Validação */}
          {validationResult && (
            <div className={`border rounded-lg p-4 ${validationResult.passed === validationResult.total ? "border-emerald-500/30 bg-emerald-500/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
              <p className="text-sm font-medium text-white">
                Validação: {validationResult.passed}/{validationResult.total} cenários passaram
              </p>
              {validationResult.failures.length > 0 && (
                <div className="mt-2 space-y-1">
                  {validationResult.failures.map((f, i) => (
                    <p key={i} className="text-yellow-400 text-xs">
                      &quot;{f.scenario}&quot; → esperado {f.expectedIntent}, recebido {f.actualIntent}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ações */}
          {!published && (
            <div className="flex gap-3">
              <button
                onClick={handlePublish}
                disabled={publishing || !validationResult || validationResult.passed < validationResult.total}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm rounded-lg transition"
              >
                {publishing ? "Publicando..." : "Publicar nova versão"}
              </button>
              <button
                onClick={() => { setAdvisorResult(null); setValidationResult(null); setError(null); }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition"
              >
                Descartar
              </button>
            </div>
          )}

          {published && (
            <p className="text-emerald-400 text-sm">Nova versão publicada com sucesso.</p>
          )}
        </div>
      )}
    </div>
  );
}
