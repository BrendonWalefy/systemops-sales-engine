import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET — retorna o estado atual do toggle
export async function GET(): Promise<NextResponse> {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  return NextResponse.json({ autoReplyEnabled: clinic.autoReplyEnabled });
}

// POST — alterna o toggle (body: { enabled: boolean })
export async function POST(request: NextRequest): Promise<NextResponse> {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  // Simple secret check — use TOGGLE_SECRET env var to protect this endpoint
  const secret = request.headers.get("x-toggle-secret");
  if (process.env.TOGGLE_SECRET && secret !== process.env.TOGGLE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { enabled?: boolean } | null;
  if (body === null || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Body must be { enabled: boolean }" }, { status: 400 });
  }

  await db
    .update(clinics)
    .set({ autoReplyEnabled: body.enabled, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  return NextResponse.json({
    autoReplyEnabled: body.enabled,
    message: body.enabled ? "Resposta automática ATIVADA" : "Resposta automática DESATIVADA",
  });
}
