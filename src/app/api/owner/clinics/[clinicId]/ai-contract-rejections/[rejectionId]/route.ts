import { NextResponse } from "next/server";
import { revealAiContractRejection } from "@/application/observability/reveal-ai-contract-rejection";
import { readSession } from "@/application/tenancy/resolve-clinic";
import { openAiEvidence } from "@/infrastructure/crypto/ai-evidence-vault";
import { DrizzleAiContractRejectionStore } from "@/infrastructure/repositories/drizzle-ai-contract-rejection-store";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
});

function notFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export async function GET(
  _request: Request,
  { params }: {
    params: Promise<{ clinicId: string; rejectionId: string }>;
  },
): Promise<NextResponse> {
  const session = await readSession();
  if (!session || session.role !== "owner") return notFound();

  const { clinicId, rejectionId } = await params;
  const result = await revealAiContractRejection({
    organizationId: clinicId,
    rejectionId,
    ownerSubject: session.email,
    now: new Date(),
  }, {
    store: new DrizzleAiContractRejectionStore(),
    open: openAiEvidence,
  });
  if (result.status !== "revealed") return notFound();

  return NextResponse.json({
    rejectionId,
    rawOutput: result.rawOutput,
  }, { headers: NO_STORE_HEADERS });
}
