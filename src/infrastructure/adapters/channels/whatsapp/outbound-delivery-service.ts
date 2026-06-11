// Entrega ordenada de respostas multi-parte (texto → mídia → texto) no WhatsApp.
//
// Problema que resolve: o POST de mídia na Z-API retorna ACK imediato, mas a
// mídia enviada por URL ainda será baixada pela Z-API antes de chegar ao lead.
// Um texto enviado logo depois "ultrapassa" o vídeo, invertendo a ordem da
// conversa. Este serviço aguarda a confirmação de saída da fila (poll no
// message-status) antes de enviar a próxima parte.
//
// Responsabilidade única: pacing + envio + confirmação de entrega.
// Persistência (appendMessage, follow-up) fica com o chamador via callbacks.

import { sendMediaMessage } from "./whatsapp-sender";
import {
  getZApiMessageDeliveryStatus,
  type ZApiDeliveryStatus,
} from "./zapi-channel-adapter";
import type { ClinicChannelConfig } from "./channel-config";
import type { Logger } from "@/infrastructure/logging/logger";

export type OutboundPart =
  | { type: "text"; content: string }
  | {
      type: "media";
      mediaId: string;
      url: string;
      mediaType: "video" | "image";
      title: string;
      caption?: string;
    };

export type OutboundMediaPart = Extract<OutboundPart, { type: "media" }>;

export type TextSendResult = { msgId: string | null; deliveryFormat: "audio" | "text" };

type Deps = {
  sendMedia: typeof sendMediaMessage;
  getDeliveryStatus: typeof getZApiMessageDeliveryStatus;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  minGapMs: number;
  deliveryTimeoutMs: number;
  pollIntervalMs: number;
};

const DEFAULT_DEPS: Deps = {
  sendMedia: sendMediaMessage,
  getDeliveryStatus: getZApiMessageDeliveryStatus,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  minGapMs: 1_200,
  deliveryTimeoutMs: 30_000,
  pollIntervalMs: 2_000,
};

export class OutboundDeliveryService {
  private readonly deps: Deps;

  constructor(deps?: Partial<Deps>) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /**
   * Entrega as partes na ordem recebida. Após cada mídia, aguarda a confirmação
   * de saída da fila Z-API antes de prosseguir (graceful degradation: timeout ou
   * endpoint não suportado apenas logam warn e seguem — nunca pior que antes).
   *
   * Erros em mídia são logados e a entrega continua (comportamento histórico).
   * Erros em texto propagam — o chamador tem fallback próprio.
   */
  async deliver(params: {
    to: string;
    parts: OutboundPart[];
    config: ClinicChannelConfig;
    log: Logger;
    sendText: (content: string) => Promise<TextSendResult>;
    onTextSent: (e: {
      content: string;
      msgId: string | null;
      deliveryFormat: "audio" | "text";
      isFirst: boolean;
    }) => Promise<void>;
    onMediaSent: (e: { part: OutboundMediaPart; msgId: string | null }) => Promise<void>;
  }): Promise<void> {
    const { to, parts, config, log, sendText, onTextSent, onMediaSent } = params;
    let lastSentAt = 0;
    let firstTextSent = false;

    for (const part of parts) {
      const gap = this.deps.now() - lastSentAt;
      if (gap < this.deps.minGapMs) await this.deps.sleep(this.deps.minGapMs - gap);

      if (part.type === "text") {
        const result = await sendText(part.content);
        lastSentAt = this.deps.now();
        await onTextSent({
          content: part.content,
          msgId: result.msgId,
          deliveryFormat: result.deliveryFormat,
          isFirst: !firstTextSent,
        });
        firstTextSent = true;
        continue;
      }

      try {
        const msgId = await this.deps.sendMedia(to, part.url, part.mediaType, config, part.caption);
        lastSentAt = this.deps.now();
        log.info("mídia enviada", { mediaId: part.mediaId, title: part.title, msgId });
        await onMediaSent({ part, msgId });
        await this.waitForDelivery(msgId, config, log, part.mediaId);
      } catch (err) {
        log.error("falha ao enviar mídia — entrega continua", err, {
          mediaId: part.mediaId,
          title: part.title,
        });
      }
    }
  }

  // Poll no message-status até a mensagem sair da fila da Z-API.
  // Só se aplica ao provider z_api com msgId conhecido — Meta envia link de
  // texto (síncrono) e envio desabilitado (msgId null) não tem o que aguardar.
  private async waitForDelivery(
    msgId: string | null,
    config: ClinicChannelConfig,
    log: Logger,
    mediaId: string,
  ): Promise<void> {
    if (config.provider !== "z_api" || !config.zapi || !msgId) return;

    const deadline = this.deps.now() + this.deps.deliveryTimeoutMs;
    while (this.deps.now() < deadline) {
      await this.deps.sleep(this.deps.pollIntervalMs);
      const status: ZApiDeliveryStatus = await this.deps.getDeliveryStatus(msgId, config.zapi);
      if (status === "delivered") return;
      if (status === "unsupported") {
        log.warn("message-status indisponível — prosseguindo sem confirmação", { mediaId, msgId });
        return;
      }
    }
    log.warn("timeout aguardando entrega da mídia — prosseguindo", { mediaId, msgId });
  }
}
