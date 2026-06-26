import { LoginForm } from "./LoginForm";
import { SystemOpsBrand } from "@/components/systemops-brand";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: #09090b; color-scheme: dark; }

        .lp-root {
          display: flex;
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          color: #fafafa;
          --background: #09090b;
          --surface: rgba(17,17,19,0.88);
          --surface-raised: rgba(255,255,255,0.05);
          --text: #fafafa;
          --muted: #a1a1aa;
          --line: rgba(255,255,255,0.08);
          --accent: #10b981;
          --accent-strong: #34d399;
          --accent-soft: rgba(16,185,129,0.12);
          --danger: #ef4444;
          color-scheme: dark;
        }

        /* ── BRAND PANEL ── */
        .lp-brand {
          flex: 0 0 58%;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 36px 52px 36px 48px;
          background: #09090b;
        }

        .lp-brand::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, rgba(255,255,255,0.065) 1px, transparent 1px);
          background-size: 28px 28px;
          pointer-events: none;
          z-index: 0;
        }

        .lp-brand::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 70% 50% at 0% 0%, rgba(16,185,129,0.13) 0%, transparent 65%),
            radial-gradient(ellipse 55% 55% at 100% 100%, rgba(99,102,241,0.09) 0%, transparent 65%);
          pointer-events: none;
          z-index: 0;
        }

        .lp-brand-top,
        .lp-brand-center,
        .lp-brand-bottom {
          position: relative;
          z-index: 1;
        }

        .lp-wordmark {
          display: inline-flex;
          width: min(290px, 100%);
        }

        .lp-wordmark-image {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 18px;
          box-shadow: 0 18px 50px rgba(0,0,0,0.22);
        }

        .lp-s-wrap {
          position: relative;
          width: 190px;
          height: 190px;
          margin-bottom: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .lp-s-glow {
          position: absolute;
          inset: -50px;
          border-radius: 50%;
          background: radial-gradient(circle at center, rgba(16,185,129,0.22) 0%, rgba(16,185,129,0.05) 50%, transparent 70%);
          animation: lp-breathe 5s ease-in-out infinite;
        }

        .lp-s-svg {
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 0 18px rgba(52,211,153,0.38));
          animation: lp-float 7s ease-in-out infinite;
        }

        .lp-s-image {
          width: 138px;
          height: auto;
          object-fit: contain;
          border-radius: 32px;
        }

        @keyframes lp-breathe {
          0%, 100% { opacity: 0.65; transform: scale(0.94); }
          50% { opacity: 1; transform: scale(1.06); }
        }

        @keyframes lp-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        /* ── COPY ── */
        .lp-brand-center {
          display: flex;
          flex-direction: column;
        }

        .lp-headline {
          font-size: clamp(36px, 3.8vw, 52px);
          font-weight: 800;
          letter-spacing: -0.045em;
          line-height: 1.08;
          margin: 0 0 18px;
          color: #fafafa;
        }

        .lp-headline em {
          font-style: normal;
          background: linear-gradient(125deg, #34d399 10%, #10b981 55%, #059669 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-subtext {
          font-size: 15px;
          line-height: 1.68;
          color: rgba(161,161,170,0.68);
          margin: 0;
          max-width: 400px;
        }

        /* ── STATUS ── */
        .lp-status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: rgba(161,161,170,0.55);
        }

        .lp-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          flex-shrink: 0;
          animation: lp-pulse-dot 2.2s ease-in-out infinite;
        }

        @keyframes lp-pulse-dot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); }
          50% { box-shadow: 0 0 0 5px rgba(16,185,129,0); }
        }

        /* ── FORM PANEL ── */
        .lp-form {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 44px;
          background: #0a0a0d;
          border-left: 1px solid rgba(255,255,255,0.055);
        }

        .lp-form-inner {
          width: 100%;
          max-width: 340px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        .lp-form-header h2 {
          margin: 0 0 8px;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: #fafafa;
        }

        .lp-form-header p {
          margin: 0;
          font-size: 14px;
          color: rgba(161,161,170,0.62);
          line-height: 1.55;
        }

        /* ── MOBILE ── */
        @media (max-width: 720px) {
          .lp-root { flex-direction: column; }

          .lp-brand {
            flex: none;
            padding: 28px 24px 40px;
          }

          .lp-s-wrap {
            width: 120px;
            height: 120px;
            margin-bottom: 24px;
          }

          .lp-wordmark {
            width: min(230px, 100%);
          }

          .lp-s-image {
            width: 92px;
          }

          .lp-headline { font-size: 30px; }

          .lp-form {
            flex: 1;
            border-left: none;
            border-top: 1px solid rgba(255,255,255,0.055);
            padding: 36px 24px 52px;
            align-items: flex-start;
          }
        }
      `}</style>

      <div className="lp-root">
        {/* ── LEFT: Atmospheric brand panel ── */}
        <aside className="lp-brand">
          <div className="lp-brand-top">
            <span className="lp-wordmark">
              <SystemOpsBrand variant="wordmark" className="lp-wordmark-image" priority />
            </span>
          </div>

          <div className="lp-brand-center">
            <div className="lp-s-wrap">
              <div className="lp-s-glow" aria-hidden="true" />
              <SystemOpsBrand variant="icon" className="lp-s-svg lp-s-image" priority />
            </div>

            <h1 className="lp-headline">
              Sua recepção<br />
              <em>nunca para.</em>
            </h1>
            <p className="lp-subtext">
              Leads qualificados, agenda em movimento e operação
              sob controle — mesmo quando você não está por aqui.
            </p>
          </div>

          <div className="lp-brand-bottom">
            <div className="lp-status">
              <span className="lp-dot" />
              IA ativa · Atendendo agora
            </div>
          </div>
        </aside>

        {/* ── RIGHT: Login form ── */}
        <main className="lp-form">
          <div className="lp-form-inner">
            <div className="lp-form-header">
              <h2>Bem-vindo de volta.</h2>
              <p>Entre para ver o que aconteceu<br />enquanto você estava fora.</p>
            </div>

            <LoginForm error={error} />
          </div>
        </main>
      </div>
    </>
  );
}
