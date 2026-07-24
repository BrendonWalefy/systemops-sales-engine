import type { OutboundDeliveryBoundary } from "@/application/jobs/send-message-job";
import { OutboundDeliveryService } from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";

export type ReplayOutboundEffect =
  | {
      sequence: number;
      kind: "text" | "voice";
      to: string;
      content: string;
      providerMessageId: string;
    }
  | {
      sequence: number;
      kind: "media";
      to: string;
      mediaType: "image" | "video" | "audio" | "document";
      mediaUrl: string;
      caption: string | null;
      fileName: string | null;
      providerMessageId: string;
    };

/**
 * Substitui somente a fronteira irreversível do canal. O sender real continua
 * persistindo partes, avançando pipeline e agendando follow-ups exatamente como
 * em produção; chamadas ao WhatsApp/TTS/storage são transformadas em efeitos
 * capturados e identificadores sintéticos.
 */
export class ReplayOutboundCapture {
  readonly effects: ReplayOutboundEffect[] = [];
  private sequence = 0;

  createBoundary(): Partial<OutboundDeliveryBoundary> {
    return {
      sendVoiceOrText: async (to, text, _config, voiceEnabled) => {
        const effect = this.append({
          kind: voiceEnabled ? "voice" : "text",
          to,
          content: text,
        });
        return {
          msgId: effect.providerMessageId,
          deliveryFormat: voiceEnabled ? "audio" : "text",
          blobUrl: null,
        };
      },
      sendMediaMessage: async (
        to,
        mediaUrl,
        mediaType,
        _config,
        caption,
        fileName,
      ) => this.append({
        kind: "media",
        to,
        mediaType,
        mediaUrl,
        caption: caption ?? null,
        fileName: fileName ?? null,
      }).providerMessageId,
      createDeliveryService: () =>
        new OutboundDeliveryService({
          sendMedia: async (
            to,
            mediaUrl,
            mediaType,
            _config,
            caption,
            fileName,
          ) => this.append({
            kind: "media",
            to,
            mediaType,
            mediaUrl,
            caption: caption ?? null,
            fileName: fileName ?? null,
          }).providerMessageId,
          getDeliveryStatus: async () => "delivered",
          sleep: async () => {},
          now: () => this.sequence * 1_000,
          minGapMs: 0,
          deliveryTimeoutMs: 0,
          pollIntervalMs: 0,
        }),
    };
  }

  private append(
    effect:
      | Omit<Extract<ReplayOutboundEffect, { kind: "text" | "voice" }>, "sequence" | "providerMessageId">
      | Omit<Extract<ReplayOutboundEffect, { kind: "media" }>, "sequence" | "providerMessageId">,
  ): ReplayOutboundEffect {
    const sequence = ++this.sequence;
    const providerMessageId = `replay-capture-${sequence}`;
    const captured = { ...effect, sequence, providerMessageId } as ReplayOutboundEffect;
    this.effects.push(captured);
    return captured;
  }
}
