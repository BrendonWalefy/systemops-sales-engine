// Webhook do WAHA (ADR-010). Adapter fino: valida origem, resolve tenant pela
// sessão e persiste a entrada antes de enfileirar — mesmo contrato durável do
// webhook da Z-API.
//
// LIMITE CONHECIDO: as ramificações de operador do webhook da Z-API (revisão
// humana, comprovante de Pix, confirmação de atendimento, takeover pelo
// celular) ainda NÃO existem aqui. Elas dependem do receptionistPhone e do
// tratamento de fromMe, que são específicos daquele payload. Enquanto isso, o
// WAHA atende o caminho de lead → IA → resposta, que é o escopo de lab/demo
// da ADR-010.

import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { resolveClinicByWahaSession } from "@/application/tenancy/resolve-clinic";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import {
  buildWahaInboundEvent,
  isWahaGroupOrStatusMessage,
  type WahaWebhookEvent,
} from "@/infrastructure/adapters/channels/whatsapp/waha-inbound-event";
import { createLogger } from "@/infrastructure/logging/logger";
import { scheduleMessageWorkerWake } from "@/application/jobs/worker-wake";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Eventos de mensagem recebida. `message.any` inclui o próprio echo. */
const INBOUND_MESSAGE_EVENTS = new Set(["message"]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  // O WAHA assina webhooks com HMAC apenas na configuração avançada; o contrato
  // aqui é o mesmo da Z-API — secret compartilhado na URL configurada no
  // servidor WAHA. Só é exigido quando a env existe, para permitir rollout.
  const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided =
      new URL(request.url).searchParams.get("secret") ??
      request.headers.get("x-webhook-secret");
    if (provided !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as WahaWebhookEvent | null;
  if (!body?.payload) return new NextResponse("Bad Request", { status: 400 });

  const log = createLogger({
    scope: "WahaWebhook",
    route: "/api/whatsapp/waha",
    traceId: body.payload.id || randomUUID(),
    correlationId: body.payload.id || undefined,
  });

  // Só mensagem recebida entra no pipeline. Status de sessão, ack de entrega e
  // demais eventos são ruído para o orquestrador.
  if (!INBOUND_MESSAGE_EVENTS.has(body.event)) {
    return new NextResponse("OK", { status: 200 });
  }

  if (isWahaGroupOrStatusMessage(body)) {
    return new NextResponse("OK", { status: 200 });
  }

  // fromMe é o echo do que nós mesmos enviamos. Tratar como entrada faria a IA
  // responder a si própria.
  if (body.payload.fromMe) {
    return new NextResponse("OK", { status: 200 });
  }

  if (!body.payload.id) {
    log.error("webhook.rejected", new Error("missing_message_id"), {
      durationMs: Date.now() - startedAt,
    });
    return new NextResponse("Bad Request", { status: 400 });
  }

  const clinicId = await resolveClinicByWahaSession(body.session);
  if (!clinicId) {
    log.error("webhook.rejected", new Error("clinic_not_resolved"), {
      durationMs: Date.now() - startedAt,
      session: body.session ?? "missing",
      hint: "Cadastre a sessão do WAHA em organizations.waha_session. O nome da sessão é único em toda a frota.",
    });
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const clinicLog = log.child({ clinicId });

  try {
    const result = await persistInboundEventAndEnqueue(
      buildWahaInboundEvent({ clinicId, event: body }),
      { inboundEventStore: new DrizzleInboundEventStore() },
    );
    clinicLog.info("webhook.enqueued", {
      inboundEventId: result.inboundEventId,
      eventWasNew: result.eventWasNew,
      jobWasNew: result.jobWasNew,
      durationMs: Date.now() - startedAt,
    });
    if (result.outcome === "registered" && result.jobWasNew) {
      scheduleMessageWorkerWake(after, {
        notBefore: result.runAt,
        onResult: (wake) => clinicLog.info("webhook.worker_wake", wake),
      });
    }
  } catch (error) {
    // Erro faz o WAHA reentregar. Evento duplicado só reexecuta o enfileiramento
    // idempotente, reparando uma quebra anterior entre persistir e enfileirar.
    clinicLog.error("webhook.enqueue.failed", error, { durationMs: Date.now() - startedAt });
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  return new NextResponse("OK", { status: 200 });
}
