import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();

  const resumed = await db
    .update(conversations)
    .set({ aiPaused: false, takeoverExpiresAt: null })
    .where(
      and(
        eq(conversations.aiPaused, true),
        isNotNull(conversations.takeoverExpiresAt),
        lt(conversations.takeoverExpiresAt, now),
      ),
    )
    .returning({ id: conversations.id });

  console.log(`[ResumeExpiredTakeovers] resumed=${resumed.length}`);
  return NextResponse.json({ resumed: resumed.length });
}
