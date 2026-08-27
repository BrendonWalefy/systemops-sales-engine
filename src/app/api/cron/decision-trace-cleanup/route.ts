import { NextRequest, NextResponse } from "next/server";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";
import { DrizzleConversationV2ComparisonSink } from "@/infrastructure/repositories/drizzle-conversation-v2-comparison-sink";
import { DrizzleAiContractRejectionStore } from "@/infrastructure/repositories/drizzle-ai-contract-rejection-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const rejectionStore = new DrizzleAiContractRejectionStore();
  const [decisionTraceResult, comparisonResult, rawExpiryResult] = await Promise.allSettled([
    new DrizzleDecisionTraceStore().deleteExpired(now),
    new DrizzleConversationV2ComparisonSink({
      allowedModelIds: [],
    }).deleteExpired(now),
    rejectionStore.expireRaw(now),
  ]);
  const [metadataResult] = await Promise.allSettled([
    rejectionStore.deleteExpiredMetadata(now),
  ]);
  if (decisionTraceResult.status === "rejected") throw decisionTraceResult.reason;
  if (comparisonResult.status === "rejected") throw comparisonResult.reason;
  if (rawExpiryResult.status === "rejected") throw rawExpiryResult.reason;
  if (metadataResult.status === "rejected") throw metadataResult.reason;
  return NextResponse.json({
    deleted: {
      decisionTraces: decisionTraceResult.value,
      conversationV2Comparisons: comparisonResult.value,
      aiContractRejectionRawExpired: rawExpiryResult.value,
      aiContractRejectionMetadataDeleted: metadataResult.value,
      aiContractRejectionRawBacklogPossible: rawExpiryResult.value === 500,
      aiContractRejectionMetadataBacklogPossible: metadataResult.value === 500,
    },
  });
}
