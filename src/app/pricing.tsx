import { Check, Zap } from "lucide-react";

type Plan = {
  id: string;
  name: string;
  price: number;
  tagline: string;
  popular?: boolean;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    id: "essencial",
    name: "Essencial",
    price: 897,
    tagline: "Para clínicas que querem começar com IA",
    features: [
      "1 número WhatsApp conectado",
      "Recepcionista IA 24h / 7 dias",
      "Agendamento automático no Google Calendar",
      "Smart Inbox com histórico de leads",
      "Até 150 leads atendidos por mês",
      "Relatório mensal de conversão",
      "Suporte por e-mail em até 48h",
    ],
    cta: "Começar agora",
  },
  {
    id: "clinica",
    name: "Clínica",
    price: 1497,
    tagline: "O plano completo para clínicas em crescimento",
    popular: true,
    features: [
      "Tudo do Essencial, mais:",
      "Leads ilimitados por mês",
      "Playbook personalizado com seu tom de voz",
      "Follow-up automático de re-engajamento",
      "Classificação de temperatura de leads (frio / morno / quente)",
      "Análise de handoff com alerta de takeover",
      "Suporte via WhatsApp em até 4h",
    ],
    cta: "Quero o plano Clínica",
  },
  {
    id: "rede",
    name: "Rede",
    price: 2997,
    tagline: "Para grupos com múltiplas unidades",
    features: [
      "Tudo do Clínica, mais:",
      "Até 3 unidades no mesmo painel",
      "Dashboard centralizado do proprietário",
      "Onboarding dedicado de configuração",
      "SLA de resposta em 2h",
      "Reunião mensal de resultado com você",
      "Prioridade em novas funcionalidades",
    ],
    cta: "Falar com o time",
  },
];

function formatBrl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(cents);
}

export function Pricing() {
  return (
    <section className="pricing-section" id="precos">
      <div className="pricing-inner">
        <span className="hero-eyebrow">Planos e preços</span>

        <h2 className="pricing-headline">
          Invista em atendimento.<br />
          Colha mais agendamentos.
        </h2>

        <p className="pricing-sub">
          Uma consulta odontológica recuperada já paga meses do plano.
          Comece em minutos, cancele quando quiser.
        </p>

        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`pricing-card${plan.popular ? " pricing-card--popular" : ""}`}
            >
              {plan.popular && (
                <div className="pricing-badge">
                  <Zap size={11} strokeWidth={2.5} />
                  Mais escolhido
                </div>
              )}

              <div className="pricing-card-header">
                <h3 className="pricing-plan-name">{plan.name}</h3>
                <p className="pricing-tagline">{plan.tagline}</p>
                <div className="pricing-price">
                  <span className="pricing-amount">{formatBrl(plan.price)}</span>
                  <span className="pricing-period">/mês</span>
                </div>
              </div>

              <ul className="pricing-features">
                {plan.features.map((f) => (
                  <li key={f} className="pricing-feature">
                    <Check size={14} strokeWidth={2.5} className="pricing-check" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="https://wa.me/5511999999999"
                className={`pricing-cta${plan.popular ? " pricing-cta--primary" : ""}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="pricing-note">
          Todos os planos incluem configuração inicial sem custo.
          Sem taxa de setup, sem fidelidade mínima.
        </p>
      </div>
    </section>
  );
}
