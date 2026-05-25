"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login } from "./actions";

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
                color: "var(--muted)",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="primary-button"
          style={{ marginTop: 4, width: "100%", height: 42, fontSize: 14 }}
        >
          Entrar
        </button>
      </form>
    </>
  );
}
