import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { cookies } from "next/headers";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { leads } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Sem clínica resolvida para a sessão" }, { status: 500 });

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ leads: [] });
  }

  const pattern = `%${q}%`;

  const rows = await db
    .select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email })
    .from(leads)
    .where(
      and(
        eq(leads.clinicId, clinicId),
        or(ilike(leads.name, pattern), ilike(leads.phone, pattern)),
      ),
    )
    .limit(10);

  return NextResponse.json({ leads: rows });
}
