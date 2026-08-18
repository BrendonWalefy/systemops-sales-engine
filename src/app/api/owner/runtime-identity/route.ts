import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { describeDeploymentRuntimeIdentity } from "@/application/conversation-v2/internal-lab-approval";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Identidade de execução do deploy corrente. A approval Internal Lab é vinculada
 * ao runtime exato onde será verificada, e esse valor só existe aqui. Não retorna
 * segredo, configuração, conexão nem dado de tenant.
 */
export async function GET(): Promise<NextResponse> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  return NextResponse.json(describeDeploymentRuntimeIdentity({
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
  }));
}
