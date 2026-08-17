import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const decisionTraces = await new DrizzleDecisionTraceStore().deleteExpired(now);
  const conversationV2Comparisons = await new DrizzleConversationV2ComparisonSink({
    allowedModelIds: [],
  }).deleteExpired(now);
  return NextResponse.json({
    deleted: { decisionTraces, conversationV2Comparisons },
  });
}
