export const dynamic = "force-dynamic";

import "../campanhas.css";

import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  priceCampaigns,
  reactivationCampaigns,
  treatments,
} from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { LEAD_OUTCOME_REASON_LABELS } from "@/core/intelligence/LeadOutcomeClassifier";
import { RevisaoClient, type TargetView } from "./RevisaoClient";

type TargetRow = {
  id: string;
  lead_name: string | null;
  treatment_interest: string | null;
  outcome_reason: string | null;
  evidence_excerpt: string | null;
  confidence: number | null;
  message: string | null;
  status: string;
  rejection_reason: string | null;
};

export default async function CampanhaPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const clinicId = await requireSessionClinicId();

  const [campaign] = await db
    .select()
    .from(reactivationCampaigns)
    .where(
      and(
        eq(reactivationCampaigns.id, campaignId),
        // Escopo por clínica na própria query: um id de outra clínica devolve
        // 404, não a campanha alheia.
        eq(reactivationCampaigns.clinicId, clinicId),
      ),
    )
    .limit(1);

  if (!campaign) notFound();

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
  });

  let offerLabel: string | null = null;
  if (campaign.priceCampaignId) {
    const [offer] = await db
      .select({ name: priceCampaigns.name, treatment: treatments.name })
      .from(priceCampaigns)
      .innerJoin(treatments, eq(treatments.id, priceCampaigns.treatmentId))
      .where(eq(priceCampaigns.id, campaign.priceCampaignId))
      .limit(1);
    if (offer) offerLabel = `${offer.name} — ${offer.treatment}`;
  }

  const rows = await db.execute(sql`
    SELECT
      t.id,
      l.name                                       AS lead_name,
      l.treatment_interest,
      lo.reason                                    AS outcome_reason,
      lo.evidence_excerpt,
      lo.confidence,
      COALESCE(t.edited_message, t.draft_message)  AS message,
      t.status,
      t.rejection_reason
    FROM reactivation_campaign_targets t
    JOIN leads l ON l.id = t.lead_id
    LEFT JOIN lead_outcomes lo
      ON lo.lead_id = t.lead_id AND lo.organization_id = ${clinicId}
    WHERE t.campaign_id = ${campaignId}
      AND t.organization_id = ${clinicId}
    ORDER BY
      CASE t.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      l.name NULLS LAST
  `);

  const targets: TargetView[] = (rows.rows as TargetRow[]).map((r) => ({
    id: r.id,
    leadName: r.lead_name,
    treatmentInterest: r.treatment_interest,
    outcomeReason: r.outcome_reason,
    outcomeLabel: r.outcome_reason
      ? (LEAD_OUTCOME_REASON_LABELS[
          r.outcome_reason as keyof typeof LEAD_OUTCOME_REASON_LABELS
        ] ?? r.outcome_reason)
      : null,
    evidenceExcerpt: r.evidence_excerpt,
    confidence: r.confidence === null ? null : Number(r.confidence),
    message: r.message,
    status: r.status,
    rejectionReason: r.rejection_reason,
  }));

  return (
    <RevisaoClient
      campaign={{
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        isRehearsal: campaign.testLeadId !== null,
        deadlineLabel: campaign.deadlineAt
          ? campaign.deadlineAt.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "2-digit",
              timeZone: clinic?.timezone ?? "America/Sao_Paulo",
            })
          : null,
        offerLabel,
        dailySendCap: campaign.dailySendCap,
      }}
      targets={targets}
    />
  );
}
