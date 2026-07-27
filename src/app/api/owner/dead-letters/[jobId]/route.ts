import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { DeadLetterAction } from "@/application/jobs/manage-dead-letters";
import { DrizzleDeadLetterStore } from "@/infrastructure/repositories/drizzle-dead-letter-store";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    action?: DeadLetterAction;
    reason?: string;
    allowLateDelivery?: boolean;
  } | null;
  if (!body || !["acknowledge", "discard", "reprocess"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  try {
    await new DrizzleDeadLetterStore().resolve({
      jobId: (await params).jobId,
      action: body.action as DeadLetterAction,
      actorEmail: session.email,
      reason: body.reason ?? "",
      allowLateDelivery: body.allowLateDelivery,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao resolver dead letter." },
      { status: 409 },
    );
  }
}
