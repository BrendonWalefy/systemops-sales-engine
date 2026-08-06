import type { Metadata } from "next";
import Image from "next/image";

/**
 * Página pública de onboarding "instale o SystemOps na tela inicial".
 * Fica fora dos grupos autenticados (mesmo padrão da /login): usa o root
 * layout, sem sidebar/sessão/dados de tenant. Serve como link compartilhável
 * enquanto o app não está nas lojas oficiais.
 *
 * Personalização por querystring, sem tocar no banco:
 *   /instalar?org=Vitalli            → "Acesse a operação da Vitalli"
 *   /instalar?org=NC%20Beauty&conector=da
 *   /instalar?org=Studio%20X&conector=do
 *
 * As classes usam prefixo `inst-` de propósito: o root layout carrega o
 * globals.css, e nomes genéricos (.hero, .step, .num…) colidiriam na cascata.
 */

type SearchParams = Promise<{ org?: string; conector?: string }>;

const APP_URL = "https://app.systemops.com.br";

function readOrg(org?: string) {
  const name = org?.trim();
  return name && name.length > 0 && name.length <= 60 ? name : null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { org } = await searchParams;
  const name = readOrg(org);
  return {
    title: name ? `Instalar o SystemOps · ${name}` : "Instalar o SystemOps",
    description: "Coloque o SystemOps na tela inicial do seu celular em menos de 1 minuto.",
  };
}

export default async function InstalarPage({ searchParams }: { searchParams: SearchParams }) {
  const { org, conector } = await searchParams;
  const orgName = readOrg(org);
  const connector = conector?.trim() || "da";

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; background: #09090b; color-scheme: dark; }

        .inst-root {
          --bg: #09090b;
          --surface: rgba(20, 20, 23, 0.86);
          --surface-raised: #1c1c20;
          --text: #fafafa;
          --text-soft: #e4e4e7;
          --muted: #a1a1aa;
          --muted-dim: #71717a;
          --line: rgba(255, 255, 255, 0.09);
          --line-strong: rgba(255, 255, 255, 0.15);
          --accent: #10b981;
          --accent-strong: #34d399;
          --accent-soft: rgba(16, 185, 129, 0.12);
          --sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;

          position: relative;
          min-height: 100dvh;
          color: var(--text);
          font-family: var(--sans);
          -webkit-font-smoothing: antialiased;
          line-height: 1.5;
          overflow-x: hidden;
        }

        .inst-ambient {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(ellipse 62% 42% at 12% -4%, rgba(16, 185, 129, 0.16), transparent 60%),
            radial-gradient(ellipse 55% 50% at 104% 104%, rgba(99, 102, 241, 0.11), transparent 62%),
            var(--bg);
        }
        .inst-ambient::after {
          content: "";
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
          background-size: 26px 26px;
          -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 80%);
          mask-image: linear-gradient(180deg, #000 0%, transparent 80%);
        }

        .inst-page {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 500px;
          margin: 0 auto;
          padding: 52px 22px 40px;
        }

        /* ── Hero ── */
        .inst-hero { text-align: center; }

        .inst-appicon-wrap {
          position: relative;
          width: 104px;
          height: 104px;
          margin: 0 auto 26px;
          display: grid;
          place-items: center;
        }
        .inst-appicon-glow {
          position: absolute;
          inset: -32px;
          border-radius: 50%;
          background: radial-gradient(circle at center, rgba(16, 185, 129, 0.30) 0%, rgba(16, 185, 129, 0.06) 52%, transparent 72%);
          animation: inst-breathe 5s ease-in-out infinite;
        }
        .inst-appicon-img {
          position: relative;
          display: block;
          width: 104px;
          height: 104px;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
          animation: inst-float 7s ease-in-out infinite;
        }

        .inst-eyebrow {
          display: inline-block;
          margin-bottom: 16px;
          padding: 5px 12px;
          border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
          border-radius: 999px;
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .inst-h1 {
          margin: 0 0 14px;
          font-size: clamp(27px, 7.2vw, 37px);
          font-weight: 800;
          letter-spacing: -0.032em;
          line-height: 1.08;
          text-wrap: balance;
        }
        .inst-h1 em {
          font-style: normal;
          background: linear-gradient(125deg, #34d399 8%, #10b981 60%, #059669 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .inst-lede {
          margin: 0 auto;
          max-width: 400px;
          color: var(--muted);
          font-size: 15.5px;
          line-height: 1.62;
        }

        .inst-actions {
          margin-top: 26px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }
        .inst-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          width: 100%;
          max-width: 320px;
          padding: 14px 22px;
          border-radius: 13px;
          border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
          background: linear-gradient(150deg, var(--accent-strong), var(--accent));
          color: #06120e;
          font-size: 15.5px;
          font-weight: 750;
          letter-spacing: -0.01em;
          text-decoration: none;
          box-shadow: 0 12px 30px rgba(16, 185, 129, 0.28);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .inst-cta:hover { transform: translateY(-1px); box-shadow: 0 16px 38px rgba(16, 185, 129, 0.34); }
        .inst-cta:active { transform: translateY(0); }

        .inst-url-chip {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          color: var(--muted);
          font-family: var(--mono);
          font-size: 13px;
          letter-spacing: -0.01em;
          text-decoration: none;
          transition: color 150ms ease;
        }
        .inst-url-chip:hover { color: var(--accent-strong); }
        .inst-url-chip .inst-chip-dot {
          width: 6px; height: 6px; border-radius: 999px; flex: 0 0 auto;
          background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .inst-url-chip b { font-weight: 600; color: var(--text-soft); }

        /* ── Steps ── */
        .inst-steps { margin: 44px 0 0; padding: 0; list-style: none; }
        .inst-step { display: grid; grid-template-columns: 40px 1fr; gap: 16px; }
        .inst-rail { display: flex; flex-direction: column; align-items: center; }
        .inst-num {
          width: 34px; height: 34px; flex: 0 0 auto;
          display: grid; place-items: center;
          border-radius: 50%;
          border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums;
        }
        .inst-line {
          flex: 1 1 auto; width: 2px; margin: 6px 0; border-radius: 2px;
          background: linear-gradient(180deg, var(--line-strong), var(--line) 80%, transparent);
        }
        .inst-step:last-child .inst-line { display: none; }

        .inst-step-body { padding-bottom: 26px; }
        .inst-step-title { margin: 6px 0 6px; font-size: 16.5px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.25; }
        .inst-step-title .k { color: var(--accent-strong); font-weight: 700; }
        .inst-step-text { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
        .inst-step-text b { color: var(--text-soft); font-weight: 600; }

        .inst-demo { margin-top: 13px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .inst-ios-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 9px 13px; border: 1px solid var(--line-strong); border-radius: 11px;
          background: rgba(255, 255, 255, 0.04); color: var(--text-soft);
          font-size: 13.5px; font-weight: 600;
        }
        .inst-ios-btn svg { color: var(--accent-strong); }
        .inst-ios-row {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          width: 100%; padding: 13px 15px; border: 1px solid var(--line-strong); border-radius: 13px;
          background: rgba(255, 255, 255, 0.045); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
        }
        .inst-ios-row span { font-size: 14.5px; font-weight: 500; color: var(--text); }
        .inst-ios-glyph {
          width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center;
          border-radius: 8px; border: 1px solid var(--line-strong); background: rgba(255, 255, 255, 0.05); color: var(--text-soft);
        }
        .inst-ios-add {
          padding: 8px 15px; border-radius: 10px;
          background: linear-gradient(150deg, var(--accent-strong), var(--accent));
          color: #06120e; font-size: 13.5px; font-weight: 750;
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.28);
        }
        .inst-home-preview { display: inline-flex; flex-direction: column; align-items: center; gap: 7px; }
        .inst-mini-img {
          display: block; width: 54px; height: 54px; border-radius: 13px;
          border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
        }
        .inst-home-preview small { font-size: 11.5px; color: var(--text-soft); font-weight: 500; }

        /* ── Access card ── */
        .inst-access {
          margin-top: 8px; padding: 22px 20px;
          border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius: 18px;
          background: linear-gradient(165deg, var(--accent-soft), transparent 60%), var(--surface);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
        }
        .inst-access-head { display: flex; align-items: center; gap: 11px; margin-bottom: 4px; }
        .inst-key {
          width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center;
          border-radius: 11px; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
          background: var(--accent-soft); color: var(--accent-strong);
        }
        .inst-access-head h2 { margin: 0; font-size: 18px; font-weight: 750; letter-spacing: -0.02em; }
        .inst-access-sub { margin: 0 0 18px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }

        .inst-field { display: grid; gap: 7px; }
        .inst-field + .inst-field { margin-top: 12px; }
        .inst-field label { font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
        .inst-input {
          display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          border: 1px solid var(--line-strong); border-radius: 11px; background: rgba(0, 0, 0, 0.28);
          color: var(--muted-dim); font-size: 14.5px;
        }
        .inst-input svg { color: var(--muted); flex: 0 0 auto; }

        .inst-access-cta {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin-top: 18px; width: 100%; padding: 13px 18px;
          border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
          background: linear-gradient(150deg, var(--accent-strong), var(--accent));
          color: #06120e; font-size: 15px; font-weight: 750; text-decoration: none;
          box-shadow: 0 10px 26px rgba(16, 185, 129, 0.26);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        .inst-access-cta:hover { transform: translateY(-1px); box-shadow: 0 14px 32px rgba(16, 185, 129, 0.32); }

        .inst-access-note {
          display: flex; gap: 9px; margin-top: 16px; padding-top: 15px;
          border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; line-height: 1.5;
        }
        .inst-access-note b { color: var(--accent-strong); font-weight: 700; }
        .inst-access-note svg { color: var(--accent-strong); flex: 0 0 auto; margin-top: 1px; }

        /* ── Footer ── */
        .inst-footer { margin-top: 34px; text-align: center; }
        .inst-storeline {
          display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px;
          border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 255, 255, 0.02);
          color: var(--muted); font-size: 12.5px; line-height: 1.4;
        }
        .inst-storeline svg { color: var(--muted-dim); flex: 0 0 auto; }
        .inst-android { margin: 16px auto 0; max-width: 340px; color: var(--muted-dim); font-size: 12.5px; line-height: 1.55; }
        .inst-android b { color: var(--muted); font-weight: 600; }
        .inst-kbd {
          font-family: var(--mono); font-size: 12px; padding: 1px 6px;
          border: 1px solid var(--line-strong); border-radius: 6px; color: var(--text-soft);
        }
        .inst-brandmark { margin-top: 28px; display: inline-flex; align-items: center; gap: 10px; opacity: 0.9; }
        .inst-bm-img { display: block; width: 26px; height: 26px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1); }
        .inst-wm { display: grid; text-align: left; gap: 1px; }
        .inst-wm strong { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
        .inst-wm small { font-size: 11px; color: var(--muted-dim); }

        @keyframes inst-breathe { 0%, 100% { opacity: 0.7; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.04); } }
        @keyframes inst-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes inst-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

        .inst-reveal { animation: inst-rise 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
        .inst-d1 { animation-delay: 0.05s; }
        .inst-d2 { animation-delay: 0.13s; }
        .inst-d3 { animation-delay: 0.21s; }
        .inst-d4 { animation-delay: 0.29s; }
        .inst-d5 { animation-delay: 0.37s; }

        .inst-cta:focus-visible, .inst-access-cta:focus-visible, .inst-url-chip:focus-visible {
          outline: 2px solid var(--accent-strong); outline-offset: 3px; border-radius: 10px;
        }

        @media (prefers-reduced-motion: reduce) {
          .inst-appicon-glow, .inst-appicon-img, .inst-reveal { animation: none; }
          .inst-appicon-img { transform: none; }
        }
      `}</style>

      <div className="inst-root">
        <div className="inst-ambient" aria-hidden="true" />

        <main className="inst-page">
          <header className="inst-hero">
            <div className="inst-appicon-wrap inst-reveal">
              <div className="inst-appicon-glow" aria-hidden="true" />
              <Image
                src="/brand/systemops-icon.png"
                alt="SystemOps"
                width={104}
                height={104}
                priority
                className="inst-appicon-img"
              />
            </div>

            <div className="inst-reveal inst-d1">
              <span className="inst-eyebrow">Guia de acesso</span>
            </div>
            <h1 className="inst-h1 inst-reveal inst-d1">
              {orgName ? (
                <>
                  Acesse a operação {connector} <em>{orgName}</em>
                </>
              ) : (
                <>
                  Acesse a <em>sua operação</em>
                </>
              )}
            </h1>
            <p className="inst-lede inst-reveal inst-d2">
              Coloque o SystemOps na tela inicial do seu iPhone e acompanhe os
              atendimentos {orgName ? `${connector} ${orgName}` : "do seu negócio"} em
              um app — em tela cheia, direto nas conversas. Sem baixar nada da App Store.
            </p>

            <div className="inst-actions inst-reveal inst-d2">
              <a className="inst-cta" href="/login">
                Abrir o SystemOps
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12h13" />
                  <path d="M12.5 5.5 19 12l-6.5 6.5" />
                </svg>
              </a>
              <a className="inst-url-chip" href={APP_URL}>
                <span className="inst-chip-dot" />
                <b>app.systemops.com.br</b>
              </a>
            </div>
          </header>

          <ol className="inst-steps">
            <li className="inst-step inst-reveal inst-d2">
              <div className="inst-rail"><div className="inst-num">1</div><div className="inst-line" /></div>
              <div className="inst-step-body">
                <h3 className="inst-step-title">Abra pelo <span className="k">Safari</span></h3>
                <p className="inst-step-text">
                  Toque em <b>Abrir o SystemOps</b> acima (ou digite <b>app.systemops.com.br</b>).
                  No iPhone, use o <b>Safari</b> — só ele instala o app na tela inicial.
                </p>
              </div>
            </li>

            <li className="inst-step inst-reveal inst-d3">
              <div className="inst-rail"><div className="inst-num">2</div><div className="inst-line" /></div>
              <div className="inst-step-body">
                <h3 className="inst-step-title">Toque em <span className="k">Compartilhar</span></h3>
                <p className="inst-step-text">
                  Na barra de baixo, toque no ícone de compartilhar — um <b>quadrado com uma seta para cima</b>.
                </p>
                <div className="inst-demo">
                  <span className="inst-ios-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 3.2v11.3" />
                      <path d="M8.3 6.8 12 3l3.7 3.8" />
                      <path d="M7.2 10.2H6a1.8 1.8 0 0 0-1.8 1.8v7a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-7A1.8 1.8 0 0 0 18 10.2h-1.2" />
                    </svg>
                    Compartilhar
                  </span>
                </div>
              </div>
            </li>

            <li className="inst-step inst-reveal inst-d3">
              <div className="inst-rail"><div className="inst-num">3</div><div className="inst-line" /></div>
              <div className="inst-step-body">
                <h3 className="inst-step-title">Escolha <span className="k">“Adicionar à Tela de Início”</span></h3>
                <p className="inst-step-text">Role o menu que abriu e toque nesta opção:</p>
                <div className="inst-demo">
                  <div className="inst-ios-row">
                    <span>Adicionar à Tela de Início</span>
                    <div className="inst-ios-glyph">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="4.5" />
                        <path d="M12 8.5v7M8.5 12h7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </li>

            <li className="inst-step inst-reveal inst-d4">
              <div className="inst-rail"><div className="inst-num">4</div><div className="inst-line" /></div>
              <div className="inst-step-body">
                <h3 className="inst-step-title">Confirme em <span className="k">Adicionar</span></h3>
                <p className="inst-step-text">
                  Toque em <b>Adicionar</b> no canto superior direito. Pronto — o ícone
                  do SystemOps aparece na sua tela inicial:
                </p>
                <div className="inst-demo" style={{ gap: 16 }}>
                  <span className="inst-ios-add">Adicionar</span>
                  <div className="inst-home-preview">
                    <Image
                      src="/brand/systemops-icon.png"
                      alt="Ícone do SystemOps na tela inicial"
                      width={54}
                      height={54}
                      className="inst-mini-img"
                    />
                    <small>SystemOps</small>
                  </div>
                </div>
              </div>
            </li>
          </ol>

          <section className="inst-access inst-reveal inst-d5" aria-label="Entrar na sua operação">
            <div className="inst-access-head">
              <div className="inst-key">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="8" cy="15" r="4" />
                  <path d="M10.8 12.2 20 3" />
                  <path d="M16 7l3 3M14 9l2.5 2.5" />
                </svg>
              </div>
              <h2>{orgName ? `Entrar — ${orgName}` : "Entrar na sua conta"}</h2>
            </div>
            <p className="inst-access-sub">
              Abra o app pelo novo ícone e faça login com os dados que a SystemOps enviou para você:
            </p>

            <div className="inst-field">
              <label>E-mail</label>
              <div className="inst-input">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" />
                  <path d="M4 7l8 6 8-6" />
                </svg>
                o e-mail que você recebeu
              </div>
            </div>
            <div className="inst-field">
              <label>Senha</label>
              <div className="inst-input">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2.5" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                ••••••••
              </div>
            </div>

            <a className="inst-access-cta" href="/login">
              Ir para o login
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 12h13" />
                <path d="M12.5 5.5 19 12l-6.5 6.5" />
              </svg>
            </a>

            <div className="inst-access-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>Depois do primeiro acesso, o app <b>já abre logado</b>. É só tocar no ícone, como qualquer outro aplicativo.</span>
            </div>
          </section>

          <footer className="inst-footer">
            <div className="inst-storeline inst-reveal inst-d5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              Ainda não estamos na App Store — essa instalação te dá a mesma experiência.
            </div>

            <p className="inst-android">
              <b>Está no Android?</b> No Chrome, toque em <span className="inst-kbd">⋮</span> e escolha{" "}
              <b>Adicionar à tela inicial</b>. O resto é igual.
            </p>

            <div className="inst-brandmark">
              <Image
                src="/brand/systemops-icon.png"
                alt=""
                width={26}
                height={26}
                className="inst-bm-img"
              />
              <div className="inst-wm">
                <strong>SystemOps</strong>
                <small>Inteligência comercial e operacional com IA</small>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
