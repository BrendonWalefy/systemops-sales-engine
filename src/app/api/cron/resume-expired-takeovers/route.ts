import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();

  const resumed = await db
    .update(conversations)
    .set({ aiPaused: false, takeoverExpiresAt: null, aiResumedAt: now })
    .where(
      and(
        eq(conversations.aiPaused, true),
        isNotNull(conversations.takeoverExpiresAt),
        lt(conversations.takeoverExpiresAt, now),
      ),
    )
    .returning({ id: conversations.id, clinicId: conversations.clinicId });

  // Lote cruza clínicas — cada uma que teve pelo menos uma conversa retomada
  // precisa da própria marca (não é "uma escrita", são N escritas de N clínicas).
  const affectedClinicIds = new Set(resumed.map((row) => row.clinicId));
  for (const clinicId of affectedClinicIds) {
    bumpInboxVersion(clinicId);
  }

  console.log(`[ResumeExpiredTakeovers] resumed=${resumed.length}`);
  return NextResponse.json({ resumed: resumed.length });
}
