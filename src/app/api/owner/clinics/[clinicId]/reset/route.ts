import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { ResetClinicData } from "@/application/use-cases/clinics/reset-clinic-data";
import { DrizzleClinicResetRepository } from "@/infrastructure/repositories/drizzle-clinic-reset-repository";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { clinicId } = await params;

  const body = await request.json().catch(() => null) as {
    clinicName?: string;
    deleteCalendarEvents?: boolean;
  } | null;

  if (!body?.clinicName) {
    return NextResponse.json({ error: "Informe o nome da clínica para confirmar." }, { status: 400 });
  }

  let calendarGateway: GoogleCalendarGateway | undefined;
  if (body.deleteCalendarEvents) {
    const [clinic] = await db
      .select({ googleCalendarId: clinics.googleCalendarId })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    calendarGateway = new GoogleCalendarGateway(clinic?.googleCalendarId);
  }

  const useCase = new ResetClinicData({
    port: new DrizzleClinicResetRepository(),
    calendarGateway,
  });

  const counts = await useCase.execute({
    clinicId,
    clinicNameConfirmation: body.clinicName,
    deleteCalendarEvents: body.deleteCalendarEvents ?? false,
  });

  return NextResponse.json({ ok: true, counts });
}
