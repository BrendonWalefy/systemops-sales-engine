import { and, between, count, eq, max } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { appointments } from "@/infrastructure/db/schema";

function serializeDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}

export async function getAgendaVersion(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<string> {
  const [result] = await db
    .select({
      total: count(),
      updatedAt: max(appointments.updatedAt),
      startsAt: max(appointments.startsAt),
      endsAt: max(appointments.endsAt),
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        between(appointments.startsAt, from, to),
      ),
    );

  return [
    from.toISOString(),
    to.toISOString(),
    String(result?.total ?? 0),
    serializeDate(result?.updatedAt ?? null),
    serializeDate(result?.startsAt ?? null),
    serializeDate(result?.endsAt ?? null),
  ].join("|");
}
