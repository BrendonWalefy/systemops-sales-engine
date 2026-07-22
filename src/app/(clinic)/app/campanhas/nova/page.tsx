export const dynamic = "force-dynamic";

import "../campanhas.css";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { leads, priceCampaigns, treatments } from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { NovaCampanhaClient } from "./NovaCampanhaClient";

/** Só leads com telefone servem de contato de teste — o ensaio precisa entregar. */
const TEST_LEAD_LIMIT = 30;

export default async function NovaCampanhaPage() {
  const clinicId = await requireSessionClinicId();

  const [offers, testLeads] = await Promise.all([
    db
      .select({
        id: priceCampaigns.id,
        name: priceCampaigns.name,
        treatment: treatments.name,
      })
      .from(priceCampaigns)
      .innerJoin(treatments, eq(treatments.id, priceCampaigns.treatmentId))
      .where(
        and(eq(priceCampaigns.clinicId, clinicId), eq(priceCampaigns.isActive, true)),
      ),
    db
      .select({ id: leads.id, name: leads.name, phone: leads.phone })
      .from(leads)
      .where(and(eq(leads.clinicId, clinicId), isNotNull(leads.phone)))
      .orderBy(desc(leads.createdAt))
      .limit(TEST_LEAD_LIMIT),
  ]);

  return (
    <NovaCampanhaClient
      offers={offers.map((o) => ({ id: o.id, label: `${o.name} — ${o.treatment}` }))}
      testLeads={testLeads.map((l) => ({
        id: l.id,
        label: `${l.name ?? "(sem nome)"} · ${l.phone}`,
      }))}
    />
  );
}
