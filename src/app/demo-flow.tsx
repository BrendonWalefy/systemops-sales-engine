"use client";

import { useMemo, useState, useTransition } from "react";
import { runDemoFlow, type DemoFlowResult } from "./actions";

const examples = [
  {
    label: "Pergunta preco",
    message: "Oi, quanto custa uma harmonizacao? Da para parcelar?",
  },
  {
    label: "Quer agenda",
    message: "Boa tarde, queria marcar uma avaliacao essa semana. Tem horario?",
  },
  {
    label: "Caso sensivel",
    message: "Estou com dor e inchado depois de um procedimento, o que eu faco?",
  },
];

export function DemoFlow() {
  const [leadName, setLeadName] = useState("Mariana Lima");
  const [phone, setPhone] = useState("+5511999990000");
  const [message, setMessage] = useState(examples[0]?.message ?? "");
  const [result, setResult] = useState<DemoFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const statusLabel = useMemo(() => {
    if (!result) {
      return "Aguardando analise";
    }

    if (result.recommendation.handoffRequired) {
      return "Handoff humano";
    }

    if (result.recommendation.stage === "asked_availability") {
      return "Consultar agenda";
    }

    return "Responder lead";
  }, [result]);

  function submitDemo() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await runDemoFlow({ leadName, phone, message });
        setResult(response);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Erro ao executar fluxo");
      }
    });
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">SystemOps Core</p>
          <h1>Fluxo comercial do piloto</h1>
        </div>
        <div className="status-pill">{statusLabel}</div>
      </section>

      <section className="workspace">
        <div className="panel input-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Entrada WhatsApp</p>
              <h2>Simular lead</h2>
            </div>
          </div>

          <label>
            Nome
            <input value={leadName} onChange={(event) => setLeadName(event.target.value)} />
          </label>

          <label>
            Telefone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>

          <label>
            Mensagem recebida
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
            />
          </label>

          <div className="example-row">
            {examples.map((example) => (
              <button
                className="secondary-button"
                key={example.label}
                onClick={() => setMessage(example.message)}
                type="button"
              >
                {example.label}
              </button>
            ))}
          </div>

          <button className="primary-button" disabled={isPending} onClick={submitDemo} type="button">
            {isPending ? "Analisando..." : "Executar fluxo"}
          </button>

          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="panel output-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Agente especialista</p>
              <h2>Recomendacao</h2>
            </div>
            {result ? <Confidence value={result.recommendation.confidence} /> : null}
          </div>

          {result ? (
            <div className="recommendation-grid">
              <Metric label="Temperatura" value={translateTemperature(result.recommendation.leadTemperature)} />
              <Metric label="Etapa" value={translateStage(result.recommendation.stage)} />
              <Metric label="Proxima acao" value={result.recommendation.nextAction} />
              <Metric label="Objecao" value={result.recommendation.mainObjection ?? "Nenhuma"} />

              <div className="reply-box">
                <p className="small-label">Resposta sugerida</p>
                <p>{result.recommendation.suggestedReply}</p>
              </div>

              <div className="reply-box">
                <p className="small-label">Follow-up</p>
                <p>{result.recommendation.followUp ?? "Nao recomendado para este caso."}</p>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              Execute o fluxo para ver como a SystemOps transforma uma mensagem em acao comercial.
            </div>
          )}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <p className="eyebrow">Jornada</p>
          <ol className="journey-list">
            <li>Lead entra pelo WhatsApp</li>
            <li>Core registra lead, conversa e mensagem</li>
            <li>Agente classifica intencao, risco e proxima acao</li>
            <li>Recepcao aprova, edita ou assume handoff</li>
            <li>Custos de IA e WhatsApp ficam rastreados</li>
          </ol>
        </div>

        <div className="panel">
          <p className="eyebrow">Custo estimado</p>
          {result ? (
            <div className="cost-grid">
              <Metric label="OpenAI" value={result.costs.aiUsd} />
              <Metric label="WhatsApp" value={result.costs.whatsappUsd} />
              <Metric label="Total" value={result.costs.totalUsd} />
              <Metric label="Tokens" value={`${result.costs.inputTokens} in / ${result.costs.outputTokens} out`} />
            </div>
          ) : (
            <div className="empty-state compact">Sem consumo registrado nesta sessao.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  return <div className="confidence">{Math.round(value * 100)}% confianca</div>;
}

function translateTemperature(value: string): string {
  const labels: Record<string, string> = {
    cold: "Frio",
    warm: "Morno",
    hot: "Quente",
  };

  return labels[value] ?? value;
}

function translateStage(value: string): string {
  const labels: Record<string, string> = {
    new_lead: "Lead novo",
    asked_price: "Perguntou preco",
    asked_availability: "Pediu horario",
    objection: "Objecao",
    ready_to_schedule: "Pronto para agenda",
    clinical_sensitive: "Caso sensivel",
    unresponsive: "Sem resposta",
  };

  return labels[value] ?? value;
}

