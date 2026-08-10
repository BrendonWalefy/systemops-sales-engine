import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { createLogger } from "@/infrastructure/logging/logger";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

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

  const body = await request.json().catch(() => null) as { clinicName?: string } | null;
  if (!body?.clinicName) {
    return NextResponse.json({ error: "Informe o nome da clínica para confirmar." }, { status: 400 });
  }

  const [clinic] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinic) {
    return NextResponse.json({ error: "Clínica não encontrada." }, { status: 404 });
  }
  if (body.clinicName.trim() !== clinic.name.trim()) {
    return NextResponse.json({ error: "Nome da clínica não confere." }, { status: 400 });
  }

  // Kill switch total: desliga IA e shadow mode, move para status terminal.
  // Não apaga nenhuma linha — reversível via reactivateClinic.
  await db
    .update(organizations)
    .set({
      operationalStatus: "cancelled",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));
  bumpInboxVersion(clinicId);

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.archived", {});

  return NextResponse.json({ ok: true });
}
