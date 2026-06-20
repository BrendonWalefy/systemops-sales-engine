import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { DrizzleProfessionalRepository } from "@/infrastructure/repositories/drizzle-professional-repository";
import { clinicProfessionalsTag, clinicEquipeTag } from "@/lib/cache-tags";

export const dynamic = "force-dynamic";

const repo = new DrizzleProfessionalRepository();

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function GET(): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  try {
    const list = await repo.listByClinic(clinicId);
    return NextResponse.json({ professionals: list });
  } catch (err) {
    console.error("[professionals GET]", err);
    return NextResponse.json({ error: "Falha ao buscar profissionais" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  let body: { name: string; specialty?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  try {
    const professional = await repo.create({
      clinicId,
      name: body.name.trim(),
      specialty: body.specialty?.trim() || null,
      color: body.color ?? "#10b981",
      workSchedule: null,
      googleCalendarId: null,
      isActive: true,
    });
    revalidateTag(clinicProfessionalsTag(clinicId), "max");
    revalidateTag(clinicEquipeTag(clinicId), "max");
    return NextResponse.json({ professional }, { status: 201 });
  } catch (err) {
    console.error("[professionals POST]", err);
    return NextResponse.json({ error: "Falha ao criar profissional" }, { status: 500 });
  }
}
