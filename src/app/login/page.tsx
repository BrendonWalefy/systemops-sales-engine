import { Zap } from "lucide-react";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div className="brand-mark" style={{ width: 48, height: 48 }}>
            <Zap size={22} strokeWidth={2.5} />
          </div>
          <div style={{ textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: "var(--text)",
              }}
            >
              SystemOps
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Painel administrativo
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--surface)",
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Entrar
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Use suas credenciais de acesso
            </p>
          </div>

          {error && (
            <div
              style={{
                border: "1px solid color-mix(in srgb, var(--danger) 36%, transparent)",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.08)",
                color: "var(--danger)",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 14px",
              }}
            >
              E-mail ou senha incorretos.
            </div>
          )}

          <form action={login} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                placeholder="seu@email.com"
                required
                autoComplete="email"
              />
            </label>

            <label>
              Senha
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              className="primary-button"
              style={{ marginTop: 4, width: "100%", height: 42, fontSize: 14 }}
            >
              Entrar
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", margin: 0 }}>
          SystemOps © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
