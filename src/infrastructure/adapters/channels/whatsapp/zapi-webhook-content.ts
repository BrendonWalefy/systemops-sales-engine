import type { ZApiInboundPayload } from "./zapi-channel-adapter";

export type ResolvedLeadInboundContent =
  | {
      messageText: string;
      mediaUrl?: string;
      mediaType?: "image" | "video" | "audio" | "document";
      shouldReply: boolean;
    }
  | null;

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractReactionEmoji(payload: ZApiInboundPayload): string | null {
  const record = payload as unknown as Record<string, unknown>;
  const reaction = asRecord(record.reaction);

  return firstString(
    record.reactionText,
    record.emoji,
    reaction?.emoji,
    reaction?.reaction,
    reaction?.text,
    reaction?.message,
  );
}

export function resolveUnsupportedInboundPlaceholder(
  payload: ZApiInboundPayload,
  actor: "lead" | "operator",
): string | null {
  if (payload.sticker?.stickerUrl) {
    return actor === "lead"
      ? "[figurinha recebida]"
      : "[figurinha enviada pelo operador]";
  }

  const reactionEmoji = extractReactionEmoji(payload);
  if (reactionEmoji) {
    return actor === "lead"
      ? `[reação recebida] ${reactionEmoji}`
      : `[reação enviada pelo operador] ${reactionEmoji}`;
  }

  return null;
}

export async function resolveLeadInboundContent(params: {
  payload: ZApiInboundPayload;
  replyEnabled: boolean;
  transcriptionEnabled?: boolean;
  transcribeAudio: (audioUrl: string, mimeType: string) => Promise<string>;
}): Promise<ResolvedLeadInboundContent> {
  const {
    payload,
    replyEnabled,
    transcriptionEnabled = replyEnabled,
    transcribeAudio,
  } = params;

  const textMessage = trimmedOrNull(payload.text?.message);
  if (textMessage) {
    return { messageText: textMessage, shouldReply: replyEnabled };
  }

  if (payload.audio?.audioUrl) {
    if (!transcriptionEnabled) {
      return {
        messageText: "[áudio recebido]",
        mediaUrl: payload.audio.audioUrl,
        mediaType: "audio",
        shouldReply: false,
      };
    }

    try {
      const transcription = await transcribeAudio(
        payload.audio.audioUrl,
        payload.audio.mimeType,
      );
      return {
        messageText: `[áudio] ${transcription}`,
        mediaUrl: payload.audio.audioUrl,
        mediaType: "audio",
        shouldReply: replyEnabled,
      };
    } catch (err) {
      console.error("[ZApi] Falha ao transcrever áudio:", err);
      return {
        messageText:
          "[áudio] Transcrição automática indisponível. O lead enviou um áudio, mas não foi possível baixar ou transcrever. Peça para ele escrever a mensagem.",
        mediaUrl: payload.audio.audioUrl,
        mediaType: "audio",
        shouldReply: replyEnabled,
      };
    }
  }

  if (payload.image?.imageUrl) {
    return {
      messageText: trimmedOrNull(payload.image.caption) ?? "[imagem recebida]",
      mediaUrl: payload.image.imageUrl,
      mediaType: "image",
      shouldReply: replyEnabled,
    };
  }

  if (payload.video?.videoUrl) {
    return {
      messageText: trimmedOrNull(payload.video.caption) ?? "[vídeo recebido]",
      mediaUrl: payload.video.videoUrl,
      mediaType: "video",
      shouldReply: replyEnabled,
    };
  }

  if (payload.document?.documentUrl) {
    return {
      messageText: `[documento] ${payload.document.fileName ?? "arquivo recebido"}`,
      mediaUrl: payload.document.documentUrl,
      mediaType: "document",
      shouldReply: replyEnabled,
    };
  }

  const placeholder = resolveUnsupportedInboundPlaceholder(payload, "lead");
  if (placeholder) {
    return {
      messageText: placeholder,
      shouldReply: false,
    };
  }

  return null;
}
