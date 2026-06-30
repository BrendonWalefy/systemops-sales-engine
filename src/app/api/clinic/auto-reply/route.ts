import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { resolveOperationalStatusFromAutomationState } from "@/application/clinics/clinic-operational-status";

export const dynamic = "force-dynamic";

// GET — retorna o estado atual do toggle
export async function GET(): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId)
    return NextResponse.json(
      { error: "Sem clínica resolvida para a sessão" },
      { status: 500 },
    );

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
  });
  if (!clinic)
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  return NextResponse.json({
    autoReplyEnabled: clinic.autoReplyEnabled,
    operationalStatus: clinic.operationalStatus,
  });
}

// POST — alterna o toggle (body: { enabled: boolean })
export async function POST(request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId)
    return NextResponse.json(
      { error: "Sem clínica resolvida para a sessão" },
      { status: 500 },
    );

  // Simple secret check — use TOGGLE_SECRET env var to protect this endpoint
  const secret = request.headers.get("x-toggle-secret");
  if (process.env.TOGGLE_SECRET && secret !== process.env.TOGGLE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    enabled?: boolean;
  } | null;
  if (body === null || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "Body must be { enabled: boolean }" },
      { status: 400 },
    );
  }

  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: {
      isTest: true,
      operationalStatus: true,
    },
  });
  if (!clinic)
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  await db
    .update(organizations)
    .set({
      autoReplyEnabled: body.enabled,
      operationalStatus: resolveOperationalStatusFromAutomationState({
        currentStatus: clinic.operationalStatus,
        isTest: clinic.isTest,
        autoReplyEnabled: body.enabled,
      }),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));

  return NextResponse.json({
    autoReplyEnabled: body.enabled,
    operationalStatus: resolveOperationalStatusFromAutomationState({
      currentStatus: clinic.operationalStatus,
      isTest: clinic.isTest,
      autoReplyEnabled: body.enabled,
    }),
    message: body.enabled
      ? "Resposta automática ATIVADA"
      : "Resposta automática DESATIVADA",
  });
}
