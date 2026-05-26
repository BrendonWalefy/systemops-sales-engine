import { NextRequest, NextResponse } from "next/server";
import { markStaleLeads } from "@/application/use-cases/leads/mark-stale-leads";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  const result = await markStaleLeads({ clinicId });
  console.log(`[StaleConversations] Marcados ${result.marked} leads como lost`);
  return NextResponse.json(result);
}
