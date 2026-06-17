import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getAgendaSnapshotSignature } from "@/app/(clinic)/app/agenda/get-agenda-snapshot-signature";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from e to são obrigatórios (ISO 8601)" }, { status: 400 });
  }

  const signature = await getAgendaSnapshotSignature(clinicId, new Date(from), new Date(to));

  return NextResponse.json(
    { signature },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
