import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { createLogger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Áudio de TTS vive no Blob só até o WhatsApp buscar o arquivo; passadas 2h
// ninguém mais o referencia. Diferente do `media-cleanup`, aqui não há registro
// no banco para guiar a limpeza — a varredura é pelo prefixo do Blob.
//
// Migrado do GitHub Actions em 21/07: rodava lá a cada 2h só por conveniência de
// agendamento sub-diário, mas o GitHub cobra no mínimo 1 minuto por job e um
// curl de segundos custava 1 minuto cheio, 12 vezes ao dia. Ver ADR de custos.
const TTL_MS = 2 * 60 * 60 * 1000;
const PAGE_SIZE = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const log = createLogger({ scope: "TtsCleanupRoute", route: "/api/cron/tts-cleanup" });
  const startedAt = Date.now();
  const cutoff = Date.now() - TTL_MS;

  try {
    const urlsToDelete: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await list({ prefix: "tts/", limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) {
        if (new Date(blob.uploadedAt).getTime() < cutoff) urlsToDelete.push(blob.url);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    if (urlsToDelete.length > 0) await del(urlsToDelete);

    log.info("tts.cleanup.completed", { deleted: urlsToDelete.length, durationMs: Date.now() - startedAt });
    return NextResponse.json({ deleted: urlsToDelete.length });
  } catch (error) {
    log.error("tts.cleanup.failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "tts_cleanup_failed" }, { status: 500 });
  }
}
