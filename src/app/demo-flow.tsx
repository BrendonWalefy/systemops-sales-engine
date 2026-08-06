"use client";

import {
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Moon,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  runAutonomousReceptionistTurn,
  type AutonomousDemoResult,
  type DemoConversationInput,
} from "./actions";

const demoScenarios = [
  {
    id: "price",
    label: "Pergunta preço às 22h",
    story: "São 22h14. A paciente veio do Instagram e quer saber valor antes de dormir.",
    message: "Oi, vim pelo Instagram. Quanto custa clareamento?",
    outcome: "Conduzir para avaliação gratuita",
  },
  {
    id: "schedule",
    label: "Quer marcar avaliação",
    story: "A clínica está fechada, mas o lead já demonstra intenção clara de marcar.",
    message: "Quero marcar avaliação de clareamento",
    outcome: "Oferecer horários disponíveis",
  },
  {
    id: "human",
    label: "Precisa de humano",
    story: "A mensagem parece sensível. A IA precisa proteger a clínica e chamar a equipe.",
    message: "Estou com dor e inchado, o que eu faço?",
    outcome: "Acionar a equipe da clínica",
  },
];

type ChatMessage = DemoConversationInput["messages"][number];
type TimestampedMessage = ChatMessage & { timestamp: string };
type DemoScenario = (typeof demoScenarios)[number];

function getTime(hour: number): string {
  const mins = new Date().getMinutes().toString().padStart(2, "0");
  return `${String(hour).padStart(2, "0")}:${mins}`;
}

export function DemoFlow() {
  const [leadName, setLeadName] = useState("Mariana Lima");
  const [phone, setPhone] = useState("+5511999990000");
  const [clinicName, setClinicName] = useState("Clínica Aurora");
  const [simulatedHour, setSimulatedHour] = useState<10 | 22>(22);
  const [selectedScenario, setSelectedScenario] = useState<DemoScenario>(demoScenarios[0]);
  const [draft, setDraft] = useState(demoScenarios[0]?.message ?? "");
  const [messages, setMessages] = useState<TimestampedMessage[]>([]);
  const [result, setResult] = useState<AutonomousDemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAfterHours = simulatedHour === 22;

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isPending]);

  const statusLabel = useMemo(() => {
    if (!result) return "Demo pronta";
    if (result.decision.handoffRequired) return "Equipe humana acionada";
    if (result.decision.appointment.status === "scheduled") return "Avaliação agendada";
    if (result.decision.appointment.status === "offered") return "Horários oferecidos";
    return "Atendimento autônomo";
  }, [result]);

  const temperatureConfig = useMemo(() => {
    if (!result) return null;
    const temp = result.decision.leadTemperature;
    if (temp === "hot") return { label: "Lead quente", className: "temp-hot", score: 95 };
    if (temp === "warm") return { label: "Lead morno", className: "temp-warm", score: 58 };
    return { label: "Lead frio", className: "temp-cold", score: 20 };
  }, [result]);

  const demoSummary = result ? getClientSummary(result) : null;

  function sendLeadMessage() {
    if (!draft.trim()) return;

    const now = getTime(simulatedHour);
    const nextMessages: TimestampedMessage[] = [
      ...messages,
      { author: "lead", body: draft.trim(), timestamp: now },
    ];
    setMessages(nextMessages);
    setDraft("");
    setError(null);

    startTransition(async () => {
      try {
        const response = await runAutonomousReceptionistTurn({
          leadName,
          phone,
          clinicName,
          simulatedHour,
          messages: nextMessages.map(({ author, body }) => ({ author, body })),
        });
        const agentMsg = response.messages[response.messages.length - 1];
        if (agentMsg?.author === "agent") {
          setMessages([...nextMessages, { ...agentMsg, timestamp: getTime(simulatedHour) }]);
        }
        setResult(response);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Erro ao executar o fluxo");
      }
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendLeadMessage();
    }
  }

  function switchMode(hour: 10 | 22) {
    setSimulatedHour(hour);
    setMessages([]);
    setResult(null);
    setError(null);
    setDraft(selectedScenario.message);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function chooseScenario(scenario: DemoScenario) {
    setSelectedScenario(scenario);
    setMessages([]);
    setResult(null);
    setError(null);
    setDraft(scenario.message);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function resetConversation() {
    setMessages([]);
    setResult(null);
    setError(null);
    setDraft(selectedScenario.message);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  return (
    <main className="app-shell" id="demo">
      <section className="product-area">
        <div className="demo-browser">
          <div className="browser-chrome" aria-hidden="true">
            <span />
            <span />
            <span />
            <div />
          </div>

        <header className="product-topbar">
          <div>
            <p className="eyebrow">Smart Inbox / WhatsApp</p>
            <h1>Veja o que acontece quando um lead chama sua clínica</h1>
          </div>
          <div className="topbar-actions">
            <div className="time-toggle" role="group" aria-label="Simular horário">
              <button
                className={`time-toggle-btn ${!isAfterHours ? "active" : ""}`}
                onClick={() => switchMode(10)}
                type="button"
              >
                <Sun size={13} strokeWidth={2} />
                Horário comercial
              </button>
              <button
                className={`time-toggle-btn after-hours ${isAfterHours ? "active" : ""}`}
                onClick={() => switchMode(22)}
                type="button"
              >
                <Moon size={13} strokeWidth={2} />
                Fora do horário · 22h
              </button>
            </div>
            <div className={`status-pill ${result?.decision.handoffRequired ? "status-handoff" : ""}`}>
              <span className="status-dot" />
              {statusLabel}
            </div>
          </div>
        </header>

        {isAfterHours && (
          <div className="after-hours-banner">
            <Moon size={14} strokeWidth={2} />
            <strong>{selectedScenario.story}</strong>
            <span>A clínica não precisa esperar até amanhã para responder.</span>
          </div>
        )}

        <section className="kpi-strip" aria-label="Resumo operacional">
          <Metric
            icon={<Clock size={14} />}
            label="Resposta imediata"
            value={isPending ? "Processando…" : "< 1 min"}
            context="antes do lead esfriar"
            highlight={!isPending}
          />
          <Metric
            icon={<Sparkles size={14} />}
            label="Lead qualificado"
            value={result ? translateTemperature(result.decision.leadTemperature) : "Aguardando"}
            context={result ? "pronto para a equipe" : "envie a mensagem"}
            temperatureClass={result ? `temp-${result.decision.leadTemperature}` : ""}
          />
          <Metric
            icon={<Calendar size={14} />}
            label="Próximo passo"
            value={result ? translateAppointment(result.decision.appointment.status) : "Sem oferta"}
            context={result?.decision.appointment.status === "scheduled" ? "confirmar avaliação" : "sem depender da recepção"}
          />
        </section>

        <section className="inbox-layout">
          <aside className="lead-panel panel">
            <div className="inbox-panel-header">
              <div>
                <h2>Inbox Comercial</h2>
                <span>24 conversas ativas</span>
              </div>
              <div className="online-pill">
                <span className="live-dot" />
                Online
              </div>
            </div>

            <div className="conversation-list">
              <button className="conversation-card active" type="button">
                <div className="conversation-row">
                  <strong>{leadName || "Mariana Lima"}</strong>
                  <span className="unread-dot" />
                </div>
                <span>Alta intenção</span>
              </button>
              <button className="conversation-card" type="button">
                <div className="conversation-row">
                  <strong>Carlos M.</strong>
                  <span className="unread-dot" />
                </div>
                <span>Aguardando orçamento</span>
              </button>
              <button className="conversation-card" type="button">
                <div className="conversation-row">
                  <strong>Beatriz A.</strong>
                  <span className="unread-dot" />
                </div>
                <span>Retorno em 15 dias</span>
              </button>
            </div>

            {temperatureConfig && (
              <div className={`score-bar-wrap ${temperatureConfig.className}`}>
                <div className="score-bar-header">
                  <span>Score de conversão</span>
                  <strong>{temperatureConfig.score}%</strong>
                </div>
                <div className="score-bar-track">
                  <div className="score-bar-fill" style={{ width: `${temperatureConfig.score}%` }} />
                </div>
                <span className={`temp-badge ${temperatureConfig.className}`}>{temperatureConfig.label}</span>
              </div>
            )}

            <div>
              <p className="small-label">Cenários da demo</p>
              <div className="example-row">
                {demoScenarios.map((scenario) => (
                  <button
                    className={`scenario-card ${selectedScenario.id === scenario.id ? "active" : ""}`}
                    key={scenario.id}
                    onClick={() => chooseScenario(scenario)}
                    type="button"
                  >
                    <strong>{scenario.label}</strong>
                    <span>{scenario.outcome}</span>
                  </button>
                ))}
              </div>
            </div>

            <details className="demo-settings">
              <summary>Personalizar demo</summary>
              <div className="form-stack">
                <label>
                  Nome da clínica
                  <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
                </label>
                <label>
                  Nome do lead
                  <input value={leadName} onChange={(e) => setLeadName(e.target.value)} />
                </label>
                <label>
                  Telefone
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
              </div>
            </details>

            <button className="secondary-button reset-button" onClick={resetConversation} type="button">
              <RotateCcw size={14} />
              Reiniciar conversa
            </button>
          </aside>

          <section className="chat-panel panel">
            <div className="chat-header">
              <div>
                <p className="eyebrow">
                  {isAfterHours ? "Atendimento noturno · 22h" : "Atendimento 24/7"}
                </p>
                <h2>Conversa com IA</h2>
                <span className="chat-subtitle">Cliente vê a resposta em tempo real, como no WhatsApp.</span>
              </div>
              {temperatureConfig && (
                <span className={`temp-badge ${temperatureConfig.className}`}>
                  {temperatureConfig.label}
                </span>
              )}
            </div>

            <div className="chat-window" ref={chatRef}>
              {messages.length === 0 ? (
                <div className="empty-conversation">
                  <div className="empty-icon">
                    {isAfterHours
                      ? <Moon size={32} strokeWidth={1.5} />
                      : <Bot size={32} strokeWidth={1.5} />}
                  </div>
                  <strong>
                    {isAfterHours
                      ? "São 22h. O lead acabou de chamar."
                      : "Simule uma entrada de lead"}
                  </strong>
                  <span>
                    {isAfterHours
                      ? selectedScenario.story
                      : "A IA responde em menos de 1 minuto, qualifica o interesse, oferece horários e registra tudo automaticamente."}
                  </span>
                  <div className="empty-hints">
                    <span>Escolha um cenário ou envie a mensagem atual</span>
                    <span>Enter para enviar</span>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <div className={`chat-message ${message.author}`} key={`${message.author}-${index}`}>
                      <div className="message-meta">
                        {message.author === "agent" && (
                          <span className="agent-badge">
                            <Bot size={10} strokeWidth={2} />
                            SystemOps AI
                          </span>
                        )}
                        {message.author === "lead" && (
                          <span className="lead-badge">{leadName || "Lead"}</span>
                        )}
                        <span className="message-time">{message.timestamp}</span>
                      </div>
                      <p>{message.body}</p>
                    </div>
                  ))}
                  {isPending && (
                    <div className="chat-message agent typing-indicator">
                      <div className="message-meta">
                        <span className="agent-badge">
                          <Bot size={10} strokeWidth={2} />
                          SystemOps AI
                        </span>
                      </div>
                      <div className="typing-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="composer">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite como se fosse o lead… (Enter para enviar)"
                rows={2}
              />
              <button
                className="primary-button send-button"
                disabled={isPending || !draft.trim()}
                onClick={sendLeadMessage}
                type="button"
                aria-label="Enviar mensagem"
              >
                {isPending ? <span className="spinner" /> : <Send size={16} strokeWidth={2} />}
              </button>
            </div>

            {error ? <p className="error-text">{error}</p> : null}
          </section>

          <aside className="intelligence-panel">
            <section className="panel client-result-panel">
              <p className="eyebrow">Resultado para a clínica</p>
              {result ? (
                <div className="client-result-stack">
                  <div className={`result-hero ${result.decision.handoffRequired ? "warning" : ""}`}>
                    <CheckCircle2 size={18} strokeWidth={2} />
                    <strong>{demoSummary?.headline}</strong>
                    <span>{demoSummary?.description}</span>
                  </div>
                  <div className="result-checklist">
                    {demoSummary?.items.map((item) => (
                      <div className="result-check" key={item}>
                        <CheckCircle2 size={13} strokeWidth={2.2} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                  <div className="next-action-card">
                    <span>Próxima ação</span>
                    <strong>{getPrimaryActionLabel(result)}</strong>
                    <button className="primary-button action-button" type="button">
                      Executar agora
                      <Send size={15} strokeWidth={2} />
                    </button>
                  </div>
                  {result.decision.followUp && (
                    <div className="reply-box">
                      <p className="small-label">Próximo contato</p>
                      <p>{result.decision.followUp}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">
                  <Bot size={18} strokeWidth={1.5} style={{ marginBottom: 8, color: "var(--muted)", display: "block" }} />
                  Envie a primeira mensagem para mostrar o resultado ao cliente.
                </div>
              )}
            </section>

            <section className="panel comparison-panel">
              <p className="eyebrow">O que muda</p>
              <div className="comparison-grid">
                <div>
                  <span>Sem SystemOps</span>
                  <strong>Lead esperando</strong>
                  <p>O lead esfria, compara concorrentes e a equipe começa o dia correndo atrás.</p>
                </div>
                <div className="with-systemops">
                  <span>Com SystemOps</span>
                  <strong>Responde agora</strong>
                  <p>O lead recebe atenção, horários e encaminhamento antes de perder o interesse.</p>
                </div>
              </div>
            </section>

            <section className="panel outcome-panel">
              <p className="eyebrow">Ganho imediato</p>
              <strong>{result ? "A clínica não perdeu esse lead." : "Mostre o antes e depois em uma conversa."}</strong>
              <p>
                {result
                  ? "A equipe recebe o contexto pronto e sabe exatamente qual é o próximo passo."
                  : "Quando a IA responder, este painel mostra o resultado prático para a operação."}
              </p>
            </section>

            <details className="panel technical-details">
              <summary>
                <FileText size={14} strokeWidth={2} />
                Detalhes operacionais
              </summary>
              {result ? (
                <div className="cost-list">
                  <Signal label="Ação" value={translateAction(result.decision.action)} />
                  <Signal label="Status" value={translateStage(result.decision.stage)} />
                  <Signal label="Motivo" value={result.decision.reason ?? "—"} />
                  <Signal label="Custo IA" value={result.costs.aiUsd} />
                  <Signal label="Tokens" value={`${result.costs.inputTokens} in / ${result.costs.outputTokens} out`} />
                </div>
              ) : (
                <div className="empty-state compact">Os detalhes aparecem depois da primeira resposta.</div>
              )}
            </details>

            <section className="automation-note">
              <div className="automation-header">
                <Zap size={13} strokeWidth={2.5} />
                <p className="small-label" style={{ margin: 0 }}>Playbook ativo</p>
              </div>
              <p>Nome da clínica, saudação pelo horário, empatia comercial, avaliação gratuita e horários objetivos.</p>
            </section>
          </aside>
        </section>
        </div>
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  context,
  highlight,
  temperatureClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  context?: string;
  highlight?: boolean;
  temperatureClass?: string;
}) {
  return (
    <div className={`metric ${highlight ? "metric-highlight" : ""}`}>
      <div className="metric-header">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
      </div>
      <strong className={`metric-value ${temperatureClass ?? ""}`}>{value}</strong>
      {context && <span className="metric-context">{context}</span>}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="signal">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function translateTemperature(value: string): string {
  const labels: Record<string, string> = { cold: "Frio", warm: "Morno", hot: "Quente" };
  return labels[value] ?? value;
}

function translateAction(value: string): string {
  const labels: Record<string, string> = {
    send_message: "Enviar resposta",
    offer_slots: "Oferecer horários",
    schedule_appointment: "Agendar avaliação",
    handoff_human: "Chamar humano",
  };
  return labels[value] ?? value;
}

function translateStage(value: string): string {
  const labels: Record<string, string> = {
    new_lead: "Lead novo",
    handling_price: "Tratando preço",
    collecting_schedule_preference: "Qualificando agenda",
    offering_slots: "Oferecendo horários",
    appointment_scheduled: "Avaliação agendada",
    handoff_required: "Handoff obrigatório",
  };
  return labels[value] ?? value;
}

function translateAppointment(value: string): string {
  const labels: Record<string, string> = {
    none: "Sem horário ainda",
    offered: "Horários enviados",
    scheduled: "Pré-agendada",
  };
  return labels[value] ?? value;
}

function getClientSummary(result: AutonomousDemoResult) {
  if (result.decision.handoffRequired) {
    return {
      headline: "Equipe humana chamada no momento certo",
      description: "A IA protege a experiência do paciente e evita tratar caso sensível como venda comum.",
      items: [
        "Lead recebeu resposta imediata",
        "Caso marcado como prioridade",
        "Equipe sabe por que precisa assumir",
      ],
    };
  }

  if (result.decision.appointment.status === "scheduled") {
    return {
      headline: "Avaliação pré-agendada",
      description: "A clínica acorda com o lead qualificado, horário escolhido e histórico completo.",
      items: [
        "Lead respondido em segundos",
        "Horário escolhido pelo paciente",
        "Equipe só precisa confirmar os dados finais",
      ],
    };
  }

  return {
    headline: "Lead qualificado e conduzido para agenda",
    description: "A IA respondeu, explicou o próximo passo e ofereceu horários sem depender da recepção.",
    items: [
      "Interesse identificado automaticamente",
      "Avaliação gratuita oferecida",
      "Horários enviados no mesmo atendimento",
    ],
  };
}

function getPrimaryActionLabel(result: AutonomousDemoResult): string {
  if (result.decision.handoffRequired) {
    return "Encaminhar para atendimento humano";
  }

  if (result.decision.appointment.status === "scheduled") {
    return "Confirmar avaliação com a equipe";
  }

  return "Conduzir para agendamento";
}
