import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { DrizzleDeadLetterStore } from "@/infrastructure/repositories/drizzle-dead-letter-store";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const includeResolved = request.nextUrl.searchParams.get("includeResolved") === "true";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
  const items = await new DrizzleDeadLetterStore().list({ includeResolved, limit });
  return NextResponse.json({ items });
}

async function getOwnerSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner" ? session : null;
}
