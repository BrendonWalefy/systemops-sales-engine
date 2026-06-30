"use client";

import { useActionState } from "react";
import { FlaskConical } from "lucide-react";
import { loadDemoClinic, type LoadDemoState } from "./actions";

const INITIAL: LoadDemoState = { ok: false };

export function LoadDemoClinicButton() {
  const [state, formAction, pending] = useActionState(loadDemoClinic, INITIAL);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "Isto vai APAGAR e recriar todos os dados da demo (Odonto Marques) e re-datar tudo. Continuar?",
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: pending ? "default" : "pointer",
            color: "#818cf8",
            border: "1px solid rgba(99,102,241,0.3)",
            background: "rgba(99,102,241,0.07)",
            opacity: pending ? 0.6 : 1,
          }}
        >
          <FlaskConical size={14} />
          {pending ? "Carregando…" : "Carregar demo"}
        </button>
      </form>

      {state.message && (
        <span
          style={{
            fontSize: 11,
            maxWidth: 280,
            textAlign: "right",
            color: state.ok ? "#34d399" : "#f87171",
          }}
        >
          {state.message}
          {state.ok && state.result && (
            <>
              <br />
              Login: {state.result.adminEmail} · {state.result.adminPassword}
            </>
          )}
        </span>
      )}
    </div>
  );
}
