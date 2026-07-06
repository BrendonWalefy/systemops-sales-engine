import { type NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, count, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  messages,
  conversations,
  leads,
  outboundMessages,
  channelHealthSnapshots,
} from "@/infrastructure/db/schema";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { calculateHealthScore, resolveSafetyMode } from "@/application/channel-safety/reputation-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(req);
  if (unauthorized) return unauthorized;

  const activeClinics = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      timezone: organizations.timezone,
    })
    .from(organizations)
    .where(eq(organizations.operationalStatus, "active"));

  const results = [];

  for (const clinic of activeClinics) {
    const timezone = new ClinicTimezone(clinic.timezone);
    const now = new Date();
    // Ontem baseado na data atual local da clínica
    const localYesterday = new Date(now.getTime() - 24 * 60 * 60_000);
    const startOfYesterday = timezone.startOfLocalDay(localYesterday);
    const endOfYesterday = new Date(startOfYesterday.getTime() + 24 * 60 * 60_000 - 1);
    const dateStr = localYesterday.toLocaleDateString("en-CA", { timeZone: clinic.timezone });

    // 1. Opt-out count
    const [optOutResult] = await db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.clinicId, clinic.id),
          gte(leads.contactConsentRevokedAt, startOfYesterday),
          lte(leads.contactConsentRevokedAt, endOfYesterday),
        ),
      );

    // 2. Outbound sent count
    const [outboundSentResult] = await db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.clinicId, clinic.id),
          eq(messages.author, "agent"),
          gte(messages.createdAt, startOfYesterday),
          lte(messages.createdAt, endOfYesterday),
        ),
      );

    // 3. Inbound received count
    const [inboundReceivedResult] = await db
      .select({ count: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.clinicId, clinic.id),
          eq(messages.author, "lead"),
          gte(messages.createdAt, startOfYesterday),
          lte(messages.createdAt, endOfYesterday),
        ),
      );

    // 4. Outbound cancelled count
    const [outboundCancelledResult] = await db
      .select({ count: count() })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.clinicId, clinic.id),
          eq(outboundMessages.status, "cancelled"),
          gte(outboundMessages.createdAt, startOfYesterday),
          lte(outboundMessages.createdAt, endOfYesterday),
        ),
      );

    // 5. Outbound deferred count
    const [outboundDeferredResult] = await db
      .select({ count: count() })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.clinicId, clinic.id),
          inArray(outboundMessages.lastError, [
            "outbound_hourly_cap_exceeded",
            "outbound_daily_cap_exceeded",
            "quiet_hours"
          ]),
          gte(outboundMessages.createdAt, startOfYesterday),
          lte(outboundMessages.createdAt, endOfYesterday),
        ),
      );

    // 6. Total conversations active yesterday
    const [conversationsResult] = await db
      .select({ count: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.clinicId, clinic.id),
          gte(conversations.updatedAt, startOfYesterday),
          lte(conversations.updatedAt, endOfYesterday),
        ),
      );

    const stats = {
      optOutCount: optOutResult?.count ?? 0,
      outboundSent: outboundSentResult?.count ?? 0,
      outboundCancelled: outboundCancelledResult?.count ?? 0,
      outboundDeferred: outboundDeferredResult?.count ?? 0,
      inboundReceived: inboundReceivedResult?.count ?? 0,
      conversationsTotal: conversationsResult?.count ?? 0,
    };

    const healthScore = calculateHealthScore(stats);
    const resolvedMode = resolveSafetyMode(healthScore);

    // Salvar snapshot diário
    await db.insert(channelHealthSnapshots).values({
      clinicId: clinic.id,
      date: dateStr,
      optOutCount: stats.optOutCount,
      outboundSent: stats.outboundSent,
      outboundCancelled: stats.outboundCancelled,
      outboundDeferred: stats.outboundDeferred,
      inboundReceived: stats.inboundReceived,
      healthScore,
    });

    // Atualizar modo no banco da organização (se for alteração automática)
    await db
      .update(organizations)
      .set({
        channelSafetyMode: resolvedMode,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, clinic.id));

    results.push({
      clinicId: clinic.id,
      clinicName: clinic.name,
      date: dateStr,
      stats,
      healthScore,
      resolvedMode,
    });
  }

  return NextResponse.json({
    success: true,
    processedCount: activeClinics.length,
    results,
  });
}
