export const dynamic = "force-dynamic";

/**
 * Subpágina de detalhe do Estudo de Setup (ADR-002) — mirror estrutural da
 * subpágina irmã `revisao-conversas/[reviewId]/page.tsx`. Resolve o estudo
 * por (studyId, clinicId da rota) e delega a renderização ao client
 * component irmão (setup-study-detail-ui.tsx). O card resumido e as ações
 * de status continuam na página da clínica (setup-study-ui.tsx).
 *
 * MULTI-TENANT: o estudo é resolvido por (studyId, organizationId) — guarda
 * de tenant no WHERE, mirror do padrão da subpágina irmã.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import { setupStudies, organizations } from "@/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import type { SetupFinding } from "@/domain/entities/setup-study";
import { SetupStudyDetail } from "./setup-study-detail-ui";

type Params = Promise<{ clinicId: string; studyId: string }>;

export default async function SetupStudyDetailPage({ params }: { params: Params }) {
  // Guarda de sessão — mirror do padrão adotado em revisao-conversas/[reviewId]/page.tsx.
  const store = await cookies();
  const sessionToken = store.get(COOKIE_NAME)?.value;
  const session = sessionToken ? await verifyToken(sessionToken) : null;
  if (!session || session.role !== "owner") redirect("/login");

  const { clinicId, studyId } = await params;

  const [study, clinic] = await Promise.all([
    db.query.setupStudies.findFirst({
      where: and(
        eq(setupStudies.id, studyId),
        eq(setupStudies.organizationId, clinicId),
      ),
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
      columns: { name: true },
    }),
  ]);

  if (!study || !clinic) notFound();

  return (
    <div style={{ padding: "28px 32px", maxWidth: 980, display: "grid", gap: 20 }}>
      <div>
        <Link
          href={`/owner/clinics/${clinicId}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
        >
          <ArrowLeft size={14} /> {clinic.name}
        </Link>
        <h1 style={{ margin: "10px 0 0", fontSize: 22, fontWeight: 800 }}>
          Estudo de Setup
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Divergências entre a operação real e o cadastro, identificadas pela IA a
          partir das conversas recentes.
        </p>
      </div>

      <SetupStudyDetail
        clinicId={clinicId}
        study={{
          id: study.id,
          status: study.status,
          createdAt: study.createdAt.toISOString(),
          findings: (study.findings ?? []) as SetupFinding[],
        }}
      />
    </div>
  );
}
