import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DECISION_TRACE_SCHEMA_VERSION } from "@/core/observability/DecisionTrace";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { DrizzleDecisionTraceStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
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

  return NextResponse.json(
    { conversationId, events },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
