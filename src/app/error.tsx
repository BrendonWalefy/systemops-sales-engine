"use client";

// Boundary padrão de rota: renderiza dentro do root layout quando um segmento
// lança um erro não tratado. Reporta ao Sentry e oferece recuperação.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "#fafafa" }}>
          Algo deu errado
        </h1>
        <p style={{ color: "#a1a1aa", margin: "0 0 20px", lineHeight: 1.5 }}>
          Nossa equipe já foi notificada. Tente novamente em instantes.
        </p>
        <button
          onClick={() => reset()}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: "#7c5cff",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
