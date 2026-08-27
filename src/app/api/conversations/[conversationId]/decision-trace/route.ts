import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  getSessionClinicId,
  readSession,
} from "@/application/tenancy/resolve-clinic";
import { DECISION_TRACE_SCHEMA_VERSION } from "@/core/observability/DecisionTrace";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";
import { DrizzleAiContractRejectionStore } from "@/infrastructure/repositories/drizzle-ai-contract-rejection-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.clinicId, clinicId),
      ),
    )
    .limit(1);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const batches = await new DrizzleDecisionTraceStore()
    .listByConversation(clinicId, conversationId);
  const events = batches
    .reverse()
    .flatMap((batch) => batch.events.map((event, sequence) => ({
      schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
      sequence,
      ...event,
    })));
  const aiContractRejections = session.role === "owner"
    ? (await new DrizzleAiContractRejectionStore().listByConversation(
        clinicId,
        conversationId,
      )).map((summary) => ({
        evidenceRef: summary.evidenceRef,
        turnId: summary.turnId,
        stage: summary.stage,
        modelId: summary.modelId,
        promptVersion: summary.promptVersion,
        contractVersion: summary.contractVersion,
        attempt: summary.attempt,
        issues: summary.issues,
        outputBytes: summary.outputBytes,
        captureStatus: summary.captureStatus,
        rawAvailable: summary.rawAvailable,
        rawExpiresAt: summary.rawExpiresAt.toISOString(),
        metadataExpiresAt: summary.metadataExpiresAt.toISOString(),
        createdAt: summary.createdAt.toISOString(),
      }))
    : undefined;

  return NextResponse.json(
    {
      conversationId,
      events,
      ...(aiContractRejections ? { aiContractRejections } : {}),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
