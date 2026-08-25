import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { describeInternalLabAuthorityRecoveryMetadata } from
  "@/application/conversation-v2/internal-lab-authority-recovery-metadata";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  return NextResponse.json(describeInternalLabAuthorityRecoveryMetadata(process.env, {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  }));
}
