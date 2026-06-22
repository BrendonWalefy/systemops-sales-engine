import { NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getInboxSnapshotSignature } from "@/app/(clinic)/app/inbox/get-inbox-snapshot-signature";
import { getAgendaSnapshotSignature } from "@/app/(clinic)/app/agenda/get-agenda-snapshot-signature";

export const dynamic = "force-dynamic";

function getAgendaWindow(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
    to: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
  };
}

export async function GET(): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { from, to } = getAgendaWindow();
  const [inboxSignature, agendaSignature] = await Promise.all([
    getInboxSnapshotSignature(clinicId),
    getAgendaSnapshotSignature(clinicId, from, to),
  ]);

  return NextResponse.json(
    { inboxSignature, agendaSignature },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
