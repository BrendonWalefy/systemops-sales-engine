import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const deleted = await new DrizzleDecisionTraceStore().deleteExpired(
    new Date(),
  );
  return NextResponse.json({ deleted });
}
