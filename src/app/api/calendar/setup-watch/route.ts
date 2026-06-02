import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

// Dispara o cron de renovação do canal do Google Calendar imediatamente.
// Aceita sessão de clínica admin OU Authorization: Bearer <CRON_SECRET>.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const isCronAuth = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCronAuth) {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = token ? await verifyToken(token) : null;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Delega para o cron reutilizando a mesma lógica
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/cron/calendar-watch-renew`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
