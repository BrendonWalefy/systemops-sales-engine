import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const [decisionTraceResult, comparisonResult] = await Promise.allSettled([
    new DrizzleDecisionTraceStore().deleteExpired(now),
    new DrizzleConversationV2ComparisonSink({
      allowedModelIds: [],
    }).deleteExpired(now),
  ]);
  if (decisionTraceResult.status === "rejected") throw decisionTraceResult.reason;
  if (comparisonResult.status === "rejected") throw comparisonResult.reason;
  return NextResponse.json({
    deleted: {
      decisionTraces: decisionTraceResult.value,
      conversationV2Comparisons: comparisonResult.value,
    },
  });
}
