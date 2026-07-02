import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, like, lt } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { messages as messagesTable } from "@/infrastructure/db/schema";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";

export const dynamic = "force-dynamic";

// Mídia inbound (imagem/vídeo/documento/áudio) rehostada no Vercel Blob é mantida
// por MEDIA_TTL_DAYS após o envio; passado esse prazo o arquivo é apagado do Blob e
// media_url é zerado, mas a mensagem (texto/transcrição) permanece intacta — o
// histórico de conversa e o follow-up de leads dependem só do texto, nunca do blob.
const MEDIA_TTL_DAYS = 90;
const BATCH_SIZE = 200;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const cutoff = new Date(Date.now() - MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000);
  const storage = new VercelBlobStorageGateway();

  const expired = await db
    .select({ id: messagesTable.id, mediaUrl: messagesTable.mediaUrl })
    .from(messagesTable)
    .where(
      and(
        isNotNull(messagesTable.mediaUrl),
        like(messagesTable.mediaUrl, "%.public.blob.vercel-storage.com%"),
        lt(messagesTable.createdAt, cutoff),
      ),
    )
    .limit(BATCH_SIZE);

  let deleted = 0;
  let failed = 0;

  for (const row of expired) {
    if (!row.mediaUrl) continue;
    try {
      await storage.delete(row.mediaUrl);
      await db
        .update(messagesTable)
        .set({ mediaUrl: null })
        .where(eq(messagesTable.id, row.id));
      deleted++;
    } catch (err) {
      failed++;
      console.warn(`[MediaCleanup] Falha ao apagar blob da msg ${row.id}:`, err);
    }
  }

  console.log(`[MediaCleanup] candidates=${expired.length} deleted=${deleted} failed=${failed}`);
  return NextResponse.json({ candidates: expired.length, deleted, failed });
}
