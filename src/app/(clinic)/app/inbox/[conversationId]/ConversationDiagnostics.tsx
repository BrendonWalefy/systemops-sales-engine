"use client";

import { useState } from "react";
import type {
  ConversationTraceSummaryV1,
  ConversationTraceTurnStatus,
} from "@/application/observability/conversation-trace-summary";

const STATUS_LABELS: Record<ConversationTraceTurnStatus, string> = {
  sent: "Enviado",
  ignored: "Ignorado com segurança",
  failed: "Falhou",
  pending_delivery: "Aguardando envio",
  processing: "Em processamento",
};

type DiagnosticsResponse = Readonly<{
  summary?: ConversationTraceSummaryV1;
}>;

function formatMoment(value: string | null): string {
  if (!value) return "horário indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "horário indisponível";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

function compact(values: readonly string[]): string | null {
  return values.length > 0 ? values.join(", ") : null;
}

export function ConversationDiagnostics({ conversationId }: { conversationId: string }) {
  const [summary, setSummary] = useState<ConversationTraceSummaryV1 | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  async function loadDiagnostics() {
    if (state === "loading") return;
    setState("loading");
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/decision-trace`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("diagnostics_unavailable");
      const body = await response.json() as DiagnosticsResponse;
      if (body.summary?.schemaVersion !== "conversation-trace-summary.v1") {
        throw new Error("diagnostics_contract_invalid");
      }
      setSummary(body.summary);
      setState("loaded");
    } catch {
      setSummary(null);
      setState("error");
    }
  }

  return (
    <section className="conversation-diagnostics" aria-label="Diagnóstico da IA">
      <div className="conversation-diagnostics-heading">
        <div>
          <p className="eyebrow">Rastreabilidade V2</p>
          <p className="conversation-diagnostics-help">
            Veja decisões e etapas técnicas sem conteúdo das mensagens.
          </p>
        </div>
        <button
          type="button"
          className="conversation-diagnostics-button"
          onClick={loadDiagnostics}
          disabled={state === "loading"}
        >
          {state === "loading" ? "Carregando…" : summary ? "Atualizar" : "Diagnóstico da IA"}
        </button>
      </div>

      {state === "error" && (
        <p className="conversation-diagnostics-state" role="alert">
          Diagnóstico indisponível. Tente novamente.
        </p>
      )}

      {state === "loaded" && summary?.turnCount === 0 && (
        <p className="conversation-diagnostics-state">Nenhum turno V2 registrado.</p>
      )}

      {summary && summary.turnCount > 0 && (
        <div className="conversation-diagnostics-turns">
          {summary.turns.map((turn) => {
            const duration = formatDuration(turn.durationMs);
            const capability = compact(turn.capabilityIds);
            const outcome = compact(turn.outcomeTypes);
            const validationViolations = compact(turn.validationViolations);
            const rejectionCodes = compact(turn.rejectionCodes);
            return (
              <details className="conversation-diagnostics-turn" key={turn.turnId}>
                <summary>
                  <span>{STATUS_LABELS[turn.status]}</span>
                  <time dateTime={turn.startedAt ?? undefined}>{formatMoment(turn.startedAt)}</time>
                </summary>
                <dl>
                  {turn.request && <><dt>Demanda</dt><dd>{turn.request}</dd></>}
                  {capability && <><dt>Capacidade</dt><dd>{capability}</dd></>}
                  {outcome && <><dt>Resultado</dt><dd>{outcome}</dd></>}
                  {duration && <><dt>Duração</dt><dd>{duration}</dd></>}
                  {turn.responseStrategy && (
                    <><dt>Estratégia</dt><dd>{turn.responseStrategy}</dd></>
                  )}
                  {validationViolations && (
                    <><dt>Travas</dt><dd>{validationViolations}</dd></>
                  )}
                  {rejectionCodes && (
                    <><dt>Rejeições</dt><dd>{rejectionCodes}</dd></>
                  )}
                  {turn.terminalReason && (
                    <><dt>Conclusão</dt><dd>{turn.terminalReason}</dd></>
                  )}
                </dl>
                <ol className="conversation-diagnostics-timeline">
                  {turn.timeline.map((item) => (
                    <li key={`${item.sequence}:${item.stage}:${item.occurredAt}`}>
                      <span>{item.stage}</span>
                      <time dateTime={item.occurredAt}>{formatMoment(item.occurredAt)}</time>
                    </li>
                  ))}
                </ol>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
