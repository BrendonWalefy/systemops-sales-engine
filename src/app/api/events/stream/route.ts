import { NextRequest } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getInboxSnapshotSignature } from "@/app/(clinic)/app/inbox/get-inbox-snapshot-signature";
import { getAgendaSnapshotSignature } from "@/app/(clinic)/app/agenda/get-agenda-snapshot-signature";

export const dynamic = "force-dynamic";
export const maxDuration = 280;

const TICK_MS = 4_000;
const STREAM_MAX_MS = 270_000;

// Janela larga e fixa: cobre a navegação típica da agenda sem depender do
// range visível no cliente, evitando reabrir a conexão a cada troca de view.
function getAgendaWindow(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const to = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
  return { from, to };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest): Promise<Response> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let lastInbox: string | null = null;
  let lastAgenda: string | null = null;
  let elapsedMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", close);

      controller.enqueue(encoder.encode("retry: 2000\n\n"));

      const tick = async () => {
        try {
          const { from, to } = getAgendaWindow();
          const [inboxSignature, agendaSignature] = await Promise.all([
            getInboxSnapshotSignature(clinicId),
            getAgendaSnapshotSignature(clinicId, from, to),
          ]);

          if (inboxSignature !== lastInbox) {
            lastInbox = inboxSignature;
            controller.enqueue(encoder.encode(sseEvent("inbox", { signature: inboxSignature })));
          }

          if (agendaSignature !== lastAgenda) {
            lastAgenda = agendaSignature;
            controller.enqueue(encoder.encode(sseEvent("agenda", { signature: agendaSignature })));
          }
        } catch (err) {
          console.error("[events/stream] tick error:", err);
        }

        elapsedMs += TICK_MS;
        if (request.signal.aborted) return;

        if (elapsedMs >= STREAM_MAX_MS) {
          close();
          return;
        }

        timer = setTimeout(tick, TICK_MS);
      };

      timer = setTimeout(tick, 0);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
