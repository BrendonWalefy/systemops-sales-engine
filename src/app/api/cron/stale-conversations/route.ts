import { NextRequest, NextResponse } from "next/server";
import { markStaleLeads } from "@/application/use-cases/leads/mark-stale-leads";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  let marked = 0;
  const perClinic: { clinicId: string; marked: number }[] = [];
  for (const clinicId of clinicIds) {
    const result = await markStaleLeads({ clinicId });
    marked += result.marked;
    perClinic.push({ clinicId, marked: result.marked });
  }

  console.log(`[StaleConversations] organizations=${clinicIds.length} marked=${marked}`);
  return NextResponse.json({ clinics: clinicIds.length, marked, perClinic });
}
