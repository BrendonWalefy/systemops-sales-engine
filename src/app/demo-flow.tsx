"use client";

import {
  BarChart2,
  Bot,
  Calendar,
  Clock,
  DollarSign,
  MessageSquare,
  Moon,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Users2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  runAutonomousReceptionistTurn,
  type AutonomousDemoResult,
  type DemoConversationInput,
} from "./actions";

const businessHourExamples = [
  "Oi, quanto custa clareamento?",
  "Quero saber como funciona implante",
  "Pode ser quarta às 10h",
  "Estou com dor e inchado, o que eu faço?",
];

const afterHoursExamples = [
  "Oi, vi de vocês no Instagram, como funciona?",
  "Quero marcar avaliação de clareamento",
  "Tem horário disponível essa semana?",
  "Quanto custa harmonização facial?",
];

const navItems = [
  { label: "Inbox", icon: MessageSquare, active: true },
  { label: "CRM", icon: Users2, active: false },
  { label: "Agenda", icon: Calendar, active: false },
  { label: "Analytics", icon: BarChart2, active: false },
  { label: "IA", icon: Sparkles, active: false },
];

type ChatMessage = DemoConversationInput["messages"][number];
type TimestampedMessage = ChatMessage & { timestamp: string };

function getTime(hour: number): string {
  const mins = new Date().getMinutes().toString().padStart(2, "0");
  return `${String(hour).padStart(2, "0")}:${mins}`;
}

export function DemoFlow() {
  const [leadName, setLeadName] = useState("Mariana Lima");
  const [phone, setPhone] = useState("+5511999990000");
  const [clinicName, setClinicName] = useState("Clínica Sorri");
  const [simulatedHour, setSimulatedHour] = useState<10 | 22>(10);
  const [draft, setDraft] = useState(businessHourExamples[0] ?? "");
  const [messages, setMessages] = useState<TimestampedMessage[]>([]);
  const [result, setResult] = useState<AutonomousDemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [roiLeads, setRoiLeads] = useState(30);
  const [roiTicket, setRoiTicket] = useState(1500);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAfterHours = simulatedHour === 22;
  const examples = isAfterHours ? afterHoursExamples : businessHourExamples;

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isPending]);

  const statusLabel = useMemo(() => {
    if (!result) return "Autonomia pronta";
    if (result.decision.handoffRequired) return "Handoff humano";
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

  const roiExtra = Math.round(roiLeads * 0.07);
  const roiRevenue = roiExtra * roiTicket;

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
    const ex = hour === 22 ? afterHoursExamples : businessHourExamples;
    setDraft(ex[0] ?? "");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function resetConversation() {
    setMessages([]);
    setResult(null);
    setError(null);
    setDraft(examples[0] ?? "");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  const leadInitial = (leadName.trim()[0] ?? "M").toUpperCase();

  return (
    <main className="app-shell" id="demo">
      <aside className="sidebar">
        <div className="brand-mark">
          <Zap size={20} strokeWidth={2.5} />
        </div>

        <nav className="side-nav" aria-label="Navegação principal">
          {navItems.map(({ label, icon: Icon, active }) => (
            <button className={active ? "side-nav-item active" : "side-nav-item"} key={label} type="button">
              <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="live-dot" />
          <span className="footer-label">Piloto ativo</span>
        </div>
      </aside>

      <section className="product-area">
        <header className="product-topbar">
          <div>
            <p className="eyebrow">Smart Inbox / WhatsApp</p>
            <h1>Recepcionista comercial autônoma</h1>
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
            <strong>Simulando atendimento às 22h</strong>
            <span>— quando não há ninguém na clínica para responder</span>
          </div>
        )}

        <section className="kpi-strip" aria-label="Resumo operacional">
          <Metric
            icon={<Clock size={14} />}
            label="Tempo de resposta"
            value={isPending ? "Processando…" : "< 1 min"}
            context="vs 4h média humana"
            highlight={!isPending}
          />
          <Metric
            icon={<Sparkles size={14} />}
            label="Temperatura"
            value={result ? translateTemperature(result.decision.leadTemperature) : "Aguardando"}
            context={result ? "score do lead" : "envie uma mensagem"}
            temperatureClass={result ? `temp-${result.decision.leadTemperature}` : ""}
          />
          <Metric
            icon={<Calendar size={14} />}
            label="Agenda"
            value={result ? translateAppointment(result.decision.appointment.status) : "Sem oferta"}
            context={result?.decision.appointment.status === "scheduled" ? "agendado automaticamente" : "aguardando qualificação"}
          />
          <Metric
            icon={<DollarSign size={14} />}
            label="Custo por conversa"
            value={result ? result.costs.totalUsd : "$0.000000"}
            context="custo real de IA"
          />
        </section>

        <section className="inbox-layout">
          <aside className="lead-panel panel">
            <div className="lead-card-header">
              <div className="avatar">{leadInitial}</div>
              <div className="lead-info">
                <p className="eyebrow">Lead ativo</p>
                <h2>{leadName || "Lead sem nome"}</h2>
                <span className="lead-phone">{phone}</span>
              </div>
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

            <div className="signal-list">
              <Signal label="Canal" value="WhatsApp" />
              <Signal label="Origem" value={isAfterHours ? "Rede social (22h)" : "Campanha clínica"} />
              <Signal label="Objetivo" value="Agendar avaliação" />
            </div>

            <div>
              <p className="small-label">{isAfterHours ? "Cenários · 22h" : "Cenários rápidos"}</p>
              <div className="example-row">
                {examples.map((example) => (
                  <button
                    className="secondary-button scenario-button"
                    key={example}
                    onClick={() => {
                      setDraft(example);
                      textareaRef.current?.focus();
                    }}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

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
                      ? "São 22h. Nenhuma recepcionista disponível."
                      : "Simule uma entrada de lead"}
                  </strong>
                  <span>
                    {isAfterHours
                      ? "A IA responde em segundos, qualifica o interesse e pré-agenda a avaliação — sem que ninguém precise estar acordado."
                      : "A recepcionista responde em menos de 1 minuto, qualifica o interesse, oferece horários e registra tudo automaticamente."}
                  </span>
                  <div className="empty-hints">
                    <span>↓ Escolha um cenário no painel esquerdo</span>
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
            <section className="panel">
              <p className="eyebrow">Decisão da IA</p>
              {result ? (
                <div className="decision-stack">
                  <Signal label="Ação" value={translateAction(result.decision.action)} />
                  <Signal label="Estado" value={translateStage(result.decision.stage)} />
                  <Signal label="Motivo" value={result.decision.reason} />
                  {result.decision.followUp && (
                    <div className="reply-box">
                      <p className="small-label">Follow-up planejado</p>
                      <p>{result.decision.followUp}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">
                  <Bot size={18} strokeWidth={1.5} style={{ marginBottom: 8, color: "var(--muted)", display: "block" }} />
                  Aguardando primeira mensagem do lead.
                </div>
              )}
            </section>

            <section className="panel">
              <p className="eyebrow">Custo estimado</p>
              {result ? (
                <div className="cost-list">
                  <Signal label="OpenAI" value={result.costs.aiUsd} />
                  <Signal label="WhatsApp" value={result.costs.whatsappUsd} />
                  <Signal label="Tokens" value={`${result.costs.inputTokens} in / ${result.costs.outputTokens} out`} />
                  <div className="cost-comparison">
                    <span>vs custo humano</span>
                    <strong className="cost-saving">~97% menor</strong>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact">Sem consumo registrado.</div>
              )}
            </section>

            <section className="panel roi-panel">
              <div className="roi-header">
                <p className="eyebrow" style={{ margin: 0 }}>Calculadora de ROI</p>
                <span className="roi-badge">piloto</span>
              </div>

              <div className="roi-inputs">
                <label className="roi-label">
                  Leads por mês
                  <div className="roi-input-row">
                    <input
                      className="roi-input"
                      type="number"
                      min={5}
                      max={500}
                      value={roiLeads}
                      onChange={(e) => setRoiLeads(Math.max(1, Number(e.target.value)))}
                    />
                    <span className="roi-unit">leads</span>
                  </div>
                </label>
                <label className="roi-label">
                  Ticket médio
                  <div className="roi-input-row">
                    <span className="roi-currency">R$</span>
                    <input
                      className="roi-input"
                      type="number"
                      min={100}
                      step={100}
                      value={roiTicket}
                      onChange={(e) => setRoiTicket(Math.max(100, Number(e.target.value)))}
                    />
                  </div>
                </label>
              </div>

              <div className="roi-result">
                <div className="roi-result-line">
                  <span>Conversões extras estimadas</span>
                  <strong>+{roiExtra} leads/mês</strong>
                </div>
                <div className="roi-result-highlight">
                  <span>Receita adicional</span>
                  <strong className="roi-revenue">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(roiRevenue)}
                    <span>/mês</span>
                  </strong>
                </div>
                <p className="roi-disclaimer">
                  Estimativa conservadora de 7% de melhoria na conversão com cobertura 24h.
                </p>
              </div>
            </section>

            <section className="automation-note">
              <div className="automation-header">
                <Zap size={13} strokeWidth={2.5} />
                <p className="small-label" style={{ margin: 0 }}>Playbook ativo</p>
              </div>
              <p>Nome, saudação por horário, empatia comercial, avaliação gratuita e horários objetivos.</p>
            </section>
          </aside>
        </section>
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
