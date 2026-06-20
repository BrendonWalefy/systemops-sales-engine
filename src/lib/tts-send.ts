import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinicModules } from "@/infrastructure/db/schema";
import { createTtsProvider } from "@/infrastructure/adapters/ai/tts/tts-gateway-factory";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";
import {
  sendMediaMessage,
  sendTextMessage,
} from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import type { ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import type { TtsConfig } from "@/domain/entities/tts-config";
import type { VoiceTtsConfig, VoiceElevenLabsConfig } from "@/application/modules/module-configs";

const DEFAULT_TTS_CONFIG: TtsConfig = { provider: "nova", speed: 0.92 };

export type VoiceConfig = {
  voiceEnabled: boolean;
  ttsConfig: TtsConfig;
};

export type SendVoiceResult = {
  msgId: string | null;
  deliveryFormat: "audio" | "text";
};

/**
 * Resolve a configuração de voz ativa para uma clínica consultando clinic_modules.
 * Prioriza voice_elevenlabs (B-WAVE) sobre voice_tts (básico).
 */
export async function resolveClinicVoiceConfig(clinicId: string): Promise<VoiceConfig> {
  const rows = await db
    .select({ moduleKey: clinicModules.moduleKey, config: clinicModules.config })
    .from(clinicModules)
    .where(and(eq(clinicModules.clinicId, clinicId), eq(clinicModules.isActive, true)));

  const elRow = rows.find((r) => r.moduleKey === "voice_elevenlabs");
  if (elRow) {
    const conf = (elRow.config ?? {}) as Partial<VoiceElevenLabsConfig>;
    return {
      voiceEnabled: true,
      ttsConfig: {
        provider: "elevenlabs",
        speed: conf.speed ?? 1.0,
        elevenLabsVoiceId: conf.voiceId,
        elevenLabsStability: conf.stability,
        elevenLabsSimilarityBoost: conf.similarityBoost,
      },
    };
  }

  const basicRow = rows.find((r) => r.moduleKey === "voice_tts");
  if (basicRow) {
    const conf = (basicRow.config ?? {}) as Partial<VoiceTtsConfig>;
    return {
      voiceEnabled: true,
      ttsConfig: { provider: conf.provider ?? "nova", speed: conf.speed ?? 0.92 },
    };
  }

  return { voiceEnabled: false, ttsConfig: DEFAULT_TTS_CONFIG };
}

/**
 * Sintetiza e envia a mensagem em áudio quando voiceEnabled=true.
 * Em caso de falha no TTS, cai silenciosamente para texto.
 *
 * O blob de áudio NÃO é deletado aqui — cleanup acontece via GitHub Actions
 * (cron a cada 2h, apaga blobs tts/ com mais de 2h). Vercel Hobby não suporta
 * crons sub-diários, por isso o cleanup vive fora da plataforma.
 */
export async function sendVoiceOrText(
  to: string,
  text: string,
  config: ClinicChannelConfig,
  voiceEnabled: boolean,
  ttsConfig: TtsConfig = DEFAULT_TTS_CONFIG,
): Promise<SendVoiceResult> {
  if (voiceEnabled) {
    try {
      const { gateway, format, contentType, speed } = createTtsProvider(ttsConfig);
      const storage = new VercelBlobStorageGateway();
      const audioBuffer = await gateway.synthesize(text, { format, speed });
      const blobUrl = await storage.upload(
        `tts/${randomUUID()}.${format}`,
        audioBuffer,
        { contentType },
      );
      const msgId = await sendMediaMessage(to, blobUrl, "audio", config);
      return { msgId, deliveryFormat: "audio" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TTS] Falhou (provider=${ttsConfig.provider}): ${msg} — enviando texto`);
    }
  }

  const msgId = await sendTextMessage(to, text, config);
  return { msgId, deliveryFormat: "text" };
}
