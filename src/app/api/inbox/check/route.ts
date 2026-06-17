import { NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getInboxSnapshotSignature } from "@/app/(clinic)/app/inbox/get-inbox-snapshot-signature";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signature = await getInboxSnapshotSignature(clinicId);

  return NextResponse.json(
    { signature },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
