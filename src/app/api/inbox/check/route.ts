import { NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getInboxVersion } from "@/app/(clinic)/app/inbox/get-inbox-version";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const version = await getInboxVersion(clinicId);

  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
