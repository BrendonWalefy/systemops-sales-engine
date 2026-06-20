import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleProfessionalRepository } from "@/infrastructure/repositories/drizzle-professional-repository";
import { clinicProfessionalsTag, clinicEquipeTag } from "@/lib/cache-tags";

export const dynamic = "force-dynamic";

const repo = new DrizzleProfessionalRepository();

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  const { id } = await params;

  let body: {
    name?: string;
    specialty?: string | null;
    color?: string;
    isActive?: boolean;
    googleCalendarId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  try {
    const updated = await repo.update(id, {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.specialty !== undefined && { specialty: body.specialty?.trim() || null }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.googleCalendarId !== undefined && { googleCalendarId: body.googleCalendarId }),
    });
    revalidateTag(clinicProfessionalsTag(clinicId), "max");
    revalidateTag(clinicEquipeTag(clinicId), "max");
    return NextResponse.json({ professional: updated });
  } catch (err) {
    console.error("[professionals PATCH]", err);
    return NextResponse.json({ error: "Falha ao atualizar profissional" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  const { id } = await params;

  try {
    await repo.delete(id);
    revalidateTag(clinicProfessionalsTag(clinicId), "max");
    revalidateTag(clinicEquipeTag(clinicId), "max");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[professionals DELETE]", err);
    return NextResponse.json({ error: "Falha ao remover profissional" }, { status: 500 });
  }
}
