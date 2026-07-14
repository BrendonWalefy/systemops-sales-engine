import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { OwnerSidebar } from "./owner-sidebar";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  // Guarda de leitura do painel inteiro: as páginas owner expõem credenciais
  // de canal (Z-API/Meta) e PII de leads, e até aqui só as server actions
  // validavam sessão. O layout cobre o acesso direto por URL; superfícies
  // novas devem manter também a checagem por página (ver
  // owner/clinics/[clinicId]/revisao-conversas/[reviewId]/page.tsx).
  if (!session || session.role !== "owner") redirect("/login");
  return (
    <div className="clinic-layout">
      <OwnerSidebar email={session.email} />

      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
    </div>
  );
}
