import { and, between, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments } from "@/infrastructure/db/schema";
import { buildAgendaSnapshotSignature } from "@/app/(clinic)/app/agenda/agenda-snapshot";

export async function getAgendaSnapshotSignature(clinicId: string, from: Date, to: Date): Promise<string> {
  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      professionalId: appointments.professionalId,
      updatedAt: appointments.updatedAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        between(appointments.startsAt, from, to),
      ),
    );

  return buildAgendaSnapshotSignature(rows);
}
