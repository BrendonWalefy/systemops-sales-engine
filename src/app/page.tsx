import { BarChart2, Clock, Zap } from "lucide-react";
import { DemoFlow } from "./demo-flow";
import { Pricing } from "./pricing";

export default function HomePage() {
  return (
    <>
      <Hero />
      <DemoFlow />
      <Pricing />
    </>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-inner">
        <span className="hero-eyebrow">Para clínicas que não perdem receita</span>

        <h1 className="hero-headline">
          Cada lead fora do horário<br />
          é uma consulta que foi embora
        </h1>

        <p className="hero-sub">
          A recepcionista autônoma responde em segundos, qualifica o interesse e
          pré-agenda a avaliação — às 22h, sábado, feriado.
          Sem intervenção humana.
        </p>

        <div className="hero-stats">
          <div className="hero-stat">
            <Clock size={16} strokeWidth={1.8} />
            <strong>{"< 1 min"}</strong>
            <span>tempo de resposta</span>
          </div>
          <div className="hero-divider" />
          <div className="hero-stat">
            <Zap size={16} strokeWidth={1.8} />
            <strong>24h</strong>
            <span>sem intervenção humana</span>
          </div>
          <div className="hero-divider" />
          <div className="hero-stat">
            <BarChart2 size={16} strokeWidth={1.8} />
            <strong>~97%</strong>
            <span>mais barato que atendente</span>
          </div>
        </div>

        <a href="#demo" className="hero-cta">
          Simule uma conversa real ↓
        </a>
      </div>
    </section>
  );
}
