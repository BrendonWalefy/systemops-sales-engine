import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import type { OperationalAlertReport } from "@/application/health/operational-alerts";
import { buildAlertDigestEmail } from "@/infrastructure/notifications/alert-email-template";
import { sendEmail } from "@/infrastructure/notifications/email-sender";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    return NextResponse.json({ error: "OWNER_EMAIL not configured" }, { status: 500 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://systemops-core.vercel.app");

  const activeClinics = await db
    .select({
      clinicId: clinics.id,
      clinicName: clinics.name,
      operationalStatus: clinics.operationalStatus,
      channelProvider: clinics.channelProvider,
      zapiInstanceId: clinics.zapiInstanceId,
      zapiToken: clinics.zapiToken,
      zapiClientToken: clinics.zapiClientToken,
      metaPhoneNumberId: clinics.metaPhoneNumberId,
      metaAccessToken: clinics.metaAccessToken,
    })
    .from(clinics)
    .where(eq(clinics.operationalStatus, "active"));

  const channelAlerts = (await Promise.all(
    activeClinics.map(async (clinic) => {
      const channelStatus = await probeClinicChannelHealth(clinic);
      if (channelStatus.status !== "degraded") return null;

      return {
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        source: "channel" as const,
        level: "critical" as const,
        title: "Canal indisponível",
        detail: channelStatus.detail ?? "Falha ativa ao validar a conectividade do canal",
      };
    }),
  )).filter((alert) => alert !== null);

  if (channelAlerts.length === 0) {
    return NextResponse.json({
      sent: false,
      reason: "no_channel_alerts",
      activeClinicCount: activeClinics.length,
    });
  }

  const report: OperationalAlertReport = {
    status: "degraded",
    activeClinicCount: activeClinics.length,
    alertCount: channelAlerts.length,
    criticalCount: channelAlerts.length,
    warnCount: 0,
    alerts: channelAlerts,
  };

  const { subject, html } = buildAlertDigestEmail(report, `${appUrl}/owner`);
  const result = await sendEmail({ to: ownerEmail, subject, html });

  if (!result.ok) {
    console.error("[channel-health-alert] Falha ao enviar email:", result.error);
    return NextResponse.json(
      { sent: false, error: result.error, alerts: report.alertCount },
      { status: 500 },
    );
  }

  console.log(
    `[channel-health-alert] Alerta de canal enviado para ${ownerEmail} — ${report.criticalCount} crítico(s)`,
  );

  return NextResponse.json({
    sent: true,
    emailId: result.id,
    activeClinicCount: report.activeClinicCount,
    criticalAlerts: report.criticalCount,
  });
}
