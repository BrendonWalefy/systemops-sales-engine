"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { login } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary-button"
      disabled={pending}
      style={{ marginTop: 4, width: "100%", height: 42, fontSize: 14, gap: 8 }}
    >
      {pending ? (
        <>
          <Loader2 size={15} style={{ animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
          Entrando…
        </>
      ) : (
        "Entrar"
      )}
    </button>
  );
}

export function LoginForm({ error }: { error?: string }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      {error && (
        <div
          style={{
            border: "1px solid color-mix(in srgb, var(--danger) 36%, transparent)",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.08)",
            color: "#f87171",
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
          <div style={{ position: "relative" }}>
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "rgba(161,161,170,0.8)",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <SubmitButton />
      </form>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
