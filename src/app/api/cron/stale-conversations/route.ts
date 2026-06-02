import { NextRequest, NextResponse } from "next/server";
import { markStaleLeads } from "@/application/use-cases/leads/mark-stale-leads";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicIds = await listAllClinicIds();
  let marked = 0;
  const perClinic: { clinicId: string; marked: number }[] = [];
  for (const clinicId of clinicIds) {
    const result = await markStaleLeads({ clinicId });
    marked += result.marked;
    perClinic.push({ clinicId, marked: result.marked });
  }

  console.log(`[StaleConversations] clinics=${clinicIds.length} marked=${marked}`);
  return NextResponse.json({ clinics: clinicIds.length, marked, perClinic });
}
