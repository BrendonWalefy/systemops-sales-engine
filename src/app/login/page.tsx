import { Zap } from "lucide-react";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div
      className="login-dark-page"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow orbs */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at 20% 10%, rgba(16,185,129,0.14) 0%, transparent 50%), " +
            "radial-gradient(circle at 80% 80%, rgba(99,102,241,0.10) 0%, transparent 45%)",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: 28,
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div className="brand-mark" style={{ width: 52, height: 52, boxShadow: "0 0 32px rgba(16,185,129,0.3)" }}>
            <Zap size={24} strokeWidth={2.5} />
          </div>
          <div style={{ textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: "#fafafa",
              }}
            >
              SystemOps
            </h1>
            <p style={{ margin: "5px 0 0", fontSize: 13, color: "rgba(161,161,170,0.9)", letterSpacing: "0.01em" }}>
              Recepcionista autônoma para clínicas
            </p>
          </div>
        </div>

        {/* Glassmorphism card with gradient border */}
        <div
          style={{
            borderRadius: 22,
            padding: "1.5px",
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.4) 0%, rgba(99,102,241,0.25) 50%, rgba(255,255,255,0.06) 100%)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.04) inset",
          }}
        >
          <div
            style={{
              borderRadius: 21,
              background: "rgba(14,14,16,0.80)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              padding: 28,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "#fafafa" }}>
                Entrar
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(161,161,170,0.8)" }}>
                Use suas credenciais de acesso
              </p>
            </div>

            <LoginForm error={error} />
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "rgba(161,161,170,0.5)", margin: 0 }}>
          SystemOps © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
