export const dynamic = "force-dynamic";

import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  reactivationCampaigns,
  reactivationCampaignTargets,
} from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { describeSegment, type AudienceSegment } from "@/application/reactivation/audience-segment";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  reviewing: "Aguardando revisão",
  approved: "Liberada",
  running: "Enviando",
  paused: "Pausada",
  done: "Concluída",
  cancelled: "Cancelada",
};

export default async function CampanhasPage() {
  const clinicId = await requireSessionClinicId();

  const campaigns = await db
    .select({
      id: reactivationCampaigns.id,
      name: reactivationCampaigns.name,
      status: reactivationCampaigns.status,
      segment: reactivationCampaigns.segment,
      deadlineAt: reactivationCampaigns.deadlineAt,
      testLeadId: reactivationCampaigns.testLeadId,
      createdAt: reactivationCampaigns.createdAt,
      total: sql<number>`(
        SELECT COUNT(*)::int FROM ${reactivationCampaignTargets}
        WHERE ${reactivationCampaignTargets.campaignId} = ${reactivationCampaigns.id}
      )`,
      sent: sql<number>`(
        SELECT COUNT(*)::int FROM ${reactivationCampaignTargets}
        WHERE ${reactivationCampaignTargets.campaignId} = ${reactivationCampaigns.id}
          AND ${reactivationCampaignTargets.status} IN ('sent', 'replied', 'converted')
      )`,
    })
    .from(reactivationCampaigns)
    .where(eq(reactivationCampaigns.clinicId, clinicId))
    .orderBy(desc(reactivationCampaigns.createdAt));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Campanhas de reativação</h1>
        <p className="muted">
          Reencontrar quem conversou e não fechou, segmentado pelo motivo. Nada é enviado sem
          revisão e aprovação.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <div className="empty-state">
          <h2>Nenhuma campanha ainda</h2>
          <p className="muted">
            As campanhas usam a análise de motivo de não-fechamento. Se ela ainda não rodou para
            a sua clínica, aguarde a próxima atualização diária.
          </p>
          <Link className="btn btn-primary" href="/app/campanhas/nova">
            Criar campanha
          </Link>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <Link className="btn btn-primary" href="/app/campanhas/nova">
              Nova campanha
            </Link>
          </div>

          <ul className="card-list">
            {campaigns.map((c) => (
              <li key={c.id} className="card">
                <Link href={`/app/campanhas/${c.id}`} className="card-link">
                  <div className="card-head">
                    <strong>{c.name}</strong>
                    <span className={`badge badge-${c.status}`}>
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                    {c.testLeadId && <span className="badge">🧪 modo ensaio</span>}
                  </div>
                  <p className="muted small">
                    {describeSegment(c.segment as AudienceSegment)}
                  </p>
                  <p className="small">
                    {c.total} contatos · {c.sent} enviadas
                    {c.deadlineAt &&
                      ` · oferta válida até ${c.deadlineAt.toLocaleDateString("pt-BR")}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
