import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
