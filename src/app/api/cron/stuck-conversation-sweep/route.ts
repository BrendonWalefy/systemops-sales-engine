import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads, messages } from "@/infrastructure/db/schema";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import {
  findStuckConversationAlerts,
  type StuckConversationCandidate,
} from "@/application/health/stuck-conversations";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";

export const dynamic = "force-dynamic";

// Threshold de margem confortável acima do pior caso normal de
// processamento (debounce 3s + espera de claim até 45s + LLM).
const STUCK_THRESHOLD_MS = 3 * 60_000;
// Limite superior é só guarda de custo de query — não regra de negócio.
const SCAN_WINDOW_MS = 24 * 60 * 60_000;

const notifier = new NotifyClinicOperators(
  new DrizzlePushSubscriptionRepository(),
  new WebPushGateway(),
);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const upperBound = new Date(now.getTime() - STUCK_THRESHOLD_MS);
  const lowerBound = new Date(now.getTime() - SCAN_WINDOW_MS);

  const rows = await db
    .select({
      conversationId: conversations.id,
      clinicId: conversations.clinicId,
      leadName: leads.name,
      leadPhone: leads.phone,
      autoReplyEnabled: clinics.autoReplyEnabled,
      operationalStatus: clinics.operationalStatus,
    })
    .from(conversations)
    .innerJoin(clinics, eq(clinics.id, conversations.clinicId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(
      and(
        eq(conversations.aiPaused, false),
        eq(conversations.needsAttention, false),
        or(
          isNull(conversations.processingUntil),
          lt(conversations.processingUntil, now),
        ),
        gt(conversations.lastMessageAt, lowerBound),
        lt(conversations.lastMessageAt, upperBound),
      ),
    );

  const eligible = rows.filter((row) =>
    shouldSendAutomatedClinicOutbound({
      autoReplyEnabled: row.autoReplyEnabled,
      operationalStatus: row.operationalStatus,
    }),
  );

  const candidates: StuckConversationCandidate[] = [];
  for (const row of eligible) {
    const [latest] = await db
      .select({
        author: messages.author,
        sentAt: messages.sentAt,
        body: messages.body,
      })
      .from(messages)
      .where(eq(messages.conversationId, row.conversationId))
      .orderBy(desc(messages.sentAt))
      .limit(1);

    if (!latest) continue;

    candidates.push({
      conversationId: row.conversationId,
      clinicId: row.clinicId,
      leadName: row.leadName,
      leadPhone: row.leadPhone ?? "—",
      latestMessageAuthor: latest.author,
      latestMessageAt: latest.sentAt,
      latestMessageBody: latest.body,
    });
  }

  const alerts = findStuckConversationAlerts(candidates, now, STUCK_THRESHOLD_MS);

  for (const alert of alerts) {
    await db
      .update(conversations)
      .set({
        needsAttention: true,
        attentionReason: alert.attentionReason,
        updatedAt: now,
      })
      .where(eq(conversations.id, alert.conversationId));

    await notifier
      .execute(alert.clinicId, {
        title: alert.pushTitle,
        body: alert.pushBody,
        url: `/app/inbox/${alert.conversationId}`,
      })
      .catch((err) =>
        console.error("[StuckConversationSweep] Push falhou:", err),
      );
  }

  console.log(
    `[StuckConversationSweep] checked=${candidates.length} flagged=${alerts.length}`,
  );

  return NextResponse.json({ checked: candidates.length, flagged: alerts.length });
}
