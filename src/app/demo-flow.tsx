"use client";

import { useMemo, useState, useTransition } from "react";
import {
  runAutonomousReceptionistTurn,
  type AutonomousDemoResult,
  type DemoConversationInput,
} from "./actions";

const examples = [
  "Oi, quanto custa clareamento?",
  "Prefiro a tarde",
  "Pode ser quinta as 16h",
  "Estou com dor e inchado, o que eu faco?",
];

type ChatMessage = DemoConversationInput["messages"][number];

export function DemoFlow() {
  const [leadName, setLeadName] = useState("Mariana Lima");
  const [phone, setPhone] = useState("+5511999990000");
  const [draft, setDraft] = useState(examples[0] ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [result, setResult] = useState<AutonomousDemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const statusLabel = useMemo(() => {
    if (!result) {
      return "Autonomia pronta";
    }

    if (result.decision.handoffRequired) {
      return "Handoff humano";
    }

    if (result.decision.appointment.status === "scheduled") {
      return "Avaliacao agendada";
    }

    if (result.decision.appointment.status === "offered") {
      return "Horarios oferecidos";
    }

    return "Atendimento autonomo";
  }, [result]);

  function sendLeadMessage() {
    if (!draft.trim()) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { author: "lead", body: draft.trim() }];
    setMessages(nextMessages);
    setDraft("");
    setError(null);

    startTransition(async () => {
      try {
        const response = await runAutonomousReceptionistTurn({
          leadName,
          phone,
          messages: nextMessages,
        });
        setMessages(response.messages);
        setResult(response);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Erro ao executar fluxo");
      }
    });
  }

  function resetConversation() {
    setMessages([]);
    setResult(null);
    setError(null);
    setDraft(examples[0] ?? "");
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">SystemOps Core</p>
          <h1>Recepcionista comercial autonoma</h1>
        </div>
        <div className="status-pill">{statusLabel}</div>
      </section>

      <section className="workspace autonomous-workspace">
        <div className="panel input-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Lead WhatsApp</p>
              <h2>Dados da conversa</h2>
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

          <div>
            <p className="small-label">Cenarios rapidos</p>
            <div className="example-row">
              {examples.map((example) => (
                <button
                  className="secondary-button"
                  key={example}
                  onClick={() => setDraft(example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <button className="secondary-button reset-button" onClick={resetConversation} type="button">
            Reiniciar conversa
          </button>

          <div className="automation-note">
            O agente responde sozinho, oferece horarios, agenda quando o lead escolhe e para em
            caso sensivel.
          </div>
        </div>

        <div className="panel chat-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Atendimento 24/7</p>
              <h2>Conversa autonoma</h2>
            </div>
            {result ? <Confidence value={result.decision.leadTemperature} /> : null}
          </div>

          <div className="chat-window">
            {messages.length === 0 ? (
              <div className="empty-state">
                Envie uma mensagem como lead para ver a recepcionista comercial atuar.
              </div>
            ) : (
              messages.map((message, index) => (
                <div className={`chat-message ${message.author}`} key={`${message.author}-${index}`}>
                  <span>{message.author === "lead" ? leadName || "Lead" : "SystemOps"}</span>
                  <p>{message.body}</p>
                </div>
              ))
            )}
          </div>

          <div className="composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Digite como se fosse o lead..."
              rows={3}
            />
            <button className="primary-button" disabled={isPending} onClick={sendLeadMessage} type="button">
              {isPending ? "Respondendo..." : "Enviar mensagem"}
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <p className="eyebrow">Decisao autonoma</p>
          {result ? (
            <div className="recommendation-grid">
              <Metric label="Acao" value={translateAction(result.decision.action)} />
              <Metric label="Estado" value={translateStage(result.decision.stage)} />
              <Metric label="Agenda" value={translateAppointment(result.decision.appointment.status)} />
              <Metric label="Motivo" value={result.decision.reason} />
              <div className="reply-box">
                <p className="small-label">Follow-up planejado</p>
                <p>{result.decision.followUp ?? "Sem follow-up automatico neste caso."}</p>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">Nenhuma decisao executada ainda.</div>
          )}
        </div>

        <div className="panel">
          <p className="eyebrow">Custo estimado do turno</p>
          {result ? (
            <div className="cost-grid">
              <Metric label="OpenAI" value={result.costs.aiUsd} />
              <Metric label="WhatsApp" value={result.costs.whatsappUsd} />
              <Metric label="Total" value={result.costs.totalUsd} />
              <Metric label="Tokens" value={`${result.costs.inputTokens} in / ${result.costs.outputTokens} out`} />
            </div>
          ) : (
            <div className="empty-state compact">Sem consumo registrado nesta conversa.</div>
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

function Confidence({ value }: { value: string }) {
  const labels: Record<string, string> = {
    cold: "Lead frio",
    warm: "Lead morno",
    hot: "Lead quente",
  };

  return <div className="confidence">{labels[value] ?? value}</div>;
}

function translateAction(value: string): string {
  const labels: Record<string, string> = {
    send_message: "Enviar resposta",
    offer_slots: "Oferecer horarios",
    schedule_appointment: "Agendar avaliacao",
    handoff_human: "Chamar humano",
  };

  return labels[value] ?? value;
}

function translateStage(value: string): string {
  const labels: Record<string, string> = {
    new_lead: "Lead novo",
    handling_price: "Tratando preco",
    collecting_schedule_preference: "Qualificando agenda",
    offering_slots: "Oferecendo horarios",
    appointment_scheduled: "Avaliacao agendada",
    handoff_required: "Handoff obrigatorio",
  };

  return labels[value] ?? value;
}

function translateAppointment(value: string): string {
  const labels: Record<string, string> = {
    none: "Sem horario ainda",
    offered: "Horarios enviados",
    scheduled: "Pre-agendada",
  };

  return labels[value] ?? value;
}

