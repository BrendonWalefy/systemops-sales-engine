export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinicMetrics, organizations, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { SuggestionsClient } from "./suggestions-client";

async function getData() {
  const clinicId = await requireSessionClinicId();

  const [latestMetrics, activeVersion, clinic] = await Promise.all([
    db
      .select()
      .from(clinicMetrics)
      .where(eq(clinicMetrics.clinicId, clinicId))
      .orderBy(desc(clinicMetrics.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),

    db
      .select()
      .from(playbookVersions)
      .where(and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")))
      .orderBy(desc(playbookVersions.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),

    db
      .select({ greetingMessage: organizations.greetingMessage, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  return { clinicId, latestMetrics, activeVersion, clinic };
}

export default async function SuggestionsPage() {
  const { clinicId, latestMetrics, activeVersion, clinic } = await getData();

  if (!latestMetrics) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-white mb-2">Sugestões de Playbook</h1>
        <p className="text-zinc-400 text-sm">
          Nenhuma métrica disponível ainda. O sistema coleta dados diariamente para gerar sugestões.
        </p>
      </div>
    );
  }

  if (!activeVersion) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-white mb-2">Sugestões de Playbook</h1>
        <p className="text-zinc-400 text-sm">
          Nenhum playbook ativo encontrado. Publique um playbook antes de gerar sugestões.
        </p>
      </div>
    );
  }

  const currentPlaybook = {
    specialty: activeVersion.specialty ?? "",
    toneOfVoice: activeVersion.toneOfVoice ?? "acolhedor",
    differentials: (activeVersion.differentials as string[] | null) ?? [],
    commercialPolicy: activeVersion.commercialPolicy ?? "",
    objections: (activeVersion.objections as Array<{ objection: string; response: string }> | null) ?? [],
    greetingMessage: clinic?.greetingMessage ?? "",
  };

  return (
    <SuggestionsClient
      clinicId={clinicId}
      metricsData={latestMetrics.data as Record<string, unknown>}
      metricsDate={latestMetrics.createdAt.toISOString()}
      currentPlaybook={currentPlaybook}
      clinicName={clinic?.name ?? "Clínica"}
    />
  );
}
