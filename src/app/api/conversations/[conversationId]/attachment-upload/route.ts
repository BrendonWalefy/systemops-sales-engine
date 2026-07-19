import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import {
  inspectOperatorAttachment,
  MAX_OPERATOR_ATTACHMENT_BYTES,
  OPERATOR_ATTACHMENT_CONTENT_TYPES,
} from "@/application/conversations/operator-attachment";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";

export const dynamic = "force-dynamic";

type UploadClientPayload = {
  fileName?: string;
  contentType?: string;
  size?: number;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, clinicId)))
    .limit(1);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  let body: HandleUploadBody;
  try {
    body = await request.json() as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: UploadClientPayload;
        try {
          payload = JSON.parse(clientPayload ?? "{}") as UploadClientPayload;
        } catch {
          throw new Error("Metadados do anexo inválidos.");
        }

        const inspection = inspectOperatorAttachment({
          name: payload.fileName ?? "",
          type: payload.contentType ?? "",
          size: payload.size ?? 0,
        });
        if ("error" in inspection) throw new Error(inspection.error);

        const expectedPrefix = `media/inbox/${conversationId}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Destino do anexo inválido.");
        }

        return {
          allowedContentTypes: OPERATOR_ATTACHMENT_CONTENT_TYPES,
          maximumSizeInBytes: MAX_OPERATOR_ATTACHMENT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            clinicId,
            conversationId,
            fileName: inspection.value.safeFileName,
          }),
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao autorizar upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
