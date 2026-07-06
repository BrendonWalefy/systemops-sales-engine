import type { ReactNode } from "react";
import type { Metadata } from "next";

/**
 * Layout do grupo público (ADR-002 Fase 2). Sem sidebar, sem sessão, sem
 * dados de tenant. A única superfície pública do app hoje é a página de
 * validação de estudo de setup, acessada por token. O `<html>`/`<body>` vêm
 * do root layout; aqui só isolamos metadata e um contêiner mobile-first.
 */

export const metadata: Metadata = {
  title: "Validação · SystemOps",
  robots: { index: false, follow: false },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#09090b",
        color: "#fafafa",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px 48px",
      }}
    >
      {children}
    </div>
  );
}
