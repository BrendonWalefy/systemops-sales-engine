import "server-only";

import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, professionals, treatments } from "@/infrastructure/db/schema";
import {
  clinicEquipeTag,
  clinicProfessionalsTag,
  clinicTreatmentsTag,
} from "@/lib/cache-tags";

export async function getCachedProfessionals(clinicId: string) {
  return unstable_cache(
    async () =>
      db
        .select({
          id: professionals.id,
          name: professionals.name,
          specialty: professionals.specialty,
          color: professionals.color,
          isActive: professionals.isActive,
        })
        .from(professionals)
        .where(eq(professionals.clinicId, clinicId))
        .orderBy(professionals.name),
    [`clinic-settings-professionals:${clinicId}`],
    {
      revalidate: 30,
      tags: [clinicProfessionalsTag(clinicId)],
    },
  )();
}

export async function getCachedEquipeData(clinicId: string) {
  return unstable_cache(
    async () => {
      const [members, clinicProfessionals] = await Promise.all([
        db
          .select({
            id: clinicMembers.id,
            email: clinicMembers.email,
            role: clinicMembers.role,
            professionalId: clinicMembers.professionalId,
            avatarUrl: clinicMembers.avatarUrl,
          })
          .from(clinicMembers)
          .where(eq(clinicMembers.clinicId, clinicId)),
        db
          .select({
            id: professionals.id,
            name: professionals.name,
          })
          .from(professionals)
          .where(eq(professionals.clinicId, clinicId))
          .orderBy(professionals.name),
      ]);

      return { members, professionals: clinicProfessionals };
    },
    [`clinic-settings-equipe:${clinicId}`],
    {
      revalidate: 30,
      tags: [clinicEquipeTag(clinicId), clinicProfessionalsTag(clinicId)],
    },
  )();
}

export async function getCachedPipelineTreatments(clinicId: string) {
  return unstable_cache(
    async () =>
      db
        .select({
          id: treatments.id,
          name: treatments.name,
          pipelineSteps: treatments.pipelineSteps,
        })
        .from(treatments)
        .where(eq(treatments.clinicId, clinicId))
        .orderBy(treatments.name),
    [`clinic-settings-pipeline:${clinicId}`],
    {
      revalidate: 30,
      tags: [clinicTreatmentsTag(clinicId)],
    },
  )();
}

export async function getCachedTreatmentsForAgenda(clinicId: string) {
  return unstable_cache(
    async () =>
      db
        .select({
          id: treatments.id,
          name: treatments.name,
          priceCents: treatments.priceCents,
        })
        .from(treatments)
        .where(eq(treatments.clinicId, clinicId))
        .orderBy(treatments.name),
    [`clinic-agenda-treatments:${clinicId}`],
    {
      revalidate: 30,
      tags: [clinicTreatmentsTag(clinicId)],
    },
  )();
}
