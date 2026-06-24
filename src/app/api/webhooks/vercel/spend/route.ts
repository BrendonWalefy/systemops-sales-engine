import { NextRequest, NextResponse } from "next/server";
import { recordVercelSpendAlert } from "@/application/finance/record-vercel-spend-alert";
import {
  getVercelSpendWebhookEventKey,
  isValidVercelWebhookSignature,
  parseVercelSpendWebhook,
} from "@/application/finance/vercel-spend-webhook";
import { DrizzlePlatformSpendAlertStore } from "@/infrastructure/repositories/drizzle-platform-spend-alert-store";
import { createLogger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const secret = process.env.VERCEL_SPEND_WEBHOOK_SECRET;

  if (!isValidVercelWebhookSignature(body, request.headers.get("x-vercel-signature"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event = parseVercelSpendWebhook(body);
  if (!event) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventTeamId = event.kind === "threshold" ? event.payload.teamId : event.teamId;
  const expectedTeamId = process.env.VERCEL_TEAM_ID;
  if (expectedTeamId && eventTeamId !== expectedTeamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (event.kind === "billing_cycle_ended") {
    createLogger({ scope: "VercelSpendWebhook" }).info("billing.cycle.ended", {
      teamId: event.teamId,
    });
    return NextResponse.json({ accepted: true, recorded: false });
  }

  const result = await recordVercelSpendAlert(
    event.payload,
    getVercelSpendWebhookEventKey(body),
    new DrizzlePlatformSpendAlertStore(),
  );

  createLogger({ scope: "VercelSpendWebhook" }).warn("billing.spend.threshold", {
    teamId: result.alert.teamId,
    thresholdPercent: result.alert.thresholdPercent,
    currentSpendUsd: result.alert.currentSpendUsd,
    budgetAmountUsd: result.alert.budgetAmountUsd,
    eventWasNew: result.isNew,
  });

  return NextResponse.json({ accepted: true, recorded: result.isNew });
}
