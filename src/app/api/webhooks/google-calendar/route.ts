import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { resolveCalendarMode } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";

export const dynamic = "force-dynamic";

// Recebe push notifications do Google Calendar quando eventos são criados,
// atualizados ou deletados. Sincroniza cancelamentos com a tabela de appointments.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const channelToken = request.headers.get("x-goog-channel-token");
  if (!channelToken || channelToken !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resourceState = request.headers.get("x-goog-resource-state");
  const channelId = request.headers.get("x-goog-channel-id");

  // Handshake inicial — só confirma o canal
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  if (resourceState !== "exists" || !channelId) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.calendarChannelId, channelId))
      .limit(1);

    if (
      !clinic ||
      !clinic.googleCalendarId ||
      resolveCalendarMode({
        calendarMode: clinic.calendarMode,
        googleCalendarId: clinic.googleCalendarId,
      }) !== "google_calendar"
    ) {
      console.warn("[GCal webhook] Clinic not eligible for GCal sync:", channelId);
      return new NextResponse(null, { status: 200 });
    }

    const gateway = new GoogleCalendarGateway(
      clinic.googleCalendarId,
      new ClinicTimezone(clinic.timezone),
      clinic.businessHours,
    );

    const { cancelledIds, nextSyncToken } = await gateway.syncCancelledEventIds(
      clinic.calendarSyncToken ?? null,
    );

    // Persiste o novo syncToken antes de processar para não perder eventos em caso de falha
    await db
      .update(clinics)
      .set({ calendarSyncToken: nextSyncToken })
      .where(eq(clinics.id, clinic.id));

    if (cancelledIds.length > 0) {
      const apptRepo = new DrizzleAppointmentRepository();
      for (const calendarEventId of cancelledIds) {
        const appt = await apptRepo.findByCalendarEventId(clinic.id, calendarEventId);
        if (!appt || appt.status === "cancelled" || appt.status === "completed") continue;
        await apptRepo.save({
          ...appt,
          status: "cancelled",
          updatedAt: new Date(),
        });
        console.info(
          `[GCal webhook] Appointment ${appt.id} cancelled (event ${calendarEventId} deleted from Calendar)`,
        );
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error("[GCal webhook]", err);
    // Retorna 200 para o Google não ficar tentando reenviar indefinidamente
    return new NextResponse(null, { status: 200 });
  }
}
