/**
 * Adapter do WAHA (WhatsApp HTTP API self-hosted) — ADR-010.
 *
 * Escopo de uso: lab, demo, piloto e números descartáveis. Cliente pagante
 * continua em Z-API/Meta. O WAHA roda a mesma engenharia reversa do WhatsApp
 * Web que a Z-API usa por baixo, mas SEM fornecedor absorvendo o risco de ban
 * — por isso o número aqui é sempre descartável.
 *
 * Contrato HTTP conforme a documentação oficial:
 *   POST {baseUrl}/api/sendText   { session, chatId, text }
 *   POST {baseUrl}/api/sendImage  { session, chatId, file: { url, mimetype, filename }, caption }
 *   POST {baseUrl}/api/sendVideo  | /api/sendVoice | /api/sendFile
 * Autenticação por header `X-Api-Key`.
 */
import type { MediaType } from "@/application/ports/channel-adapter";

export type WahaCreds = {
  baseUrl: string;
  apiKey: string;
  session: string;
};

/** WAHA endereça conversas por chatId; individuais terminam em @c.us. */
export function toWahaChatId(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.replace(/\D/g, "")}@c.us`;
}

const WAHA_MEDIA_ENDPOINT: Record<MediaType, string> = {
  image: "sendImage",
  video: "sendVideo",
  audio: "sendVoice",
  document: "sendFile",
};

const DEFAULT_MIMETYPE: Record<MediaType, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/ogg; codecs=opus",
  document: "application/pdf",
};

const EXTENSION_MIMETYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  ogg: "audio/ogg; codecs=opus",
  opus: "audio/ogg; codecs=opus",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

export function resolveWahaMimetype(
  mediaUrl: string,
  mediaType: MediaType,
  fileName?: string,
): string {
  for (const candidate of [fileName, mediaUrl]) {
    if (!candidate) continue;
    const withoutQuery = candidate.split(/[?#]/)[0];
    const extension = withoutQuery.split(".").pop()?.toLowerCase();
    if (extension && EXTENSION_MIMETYPE[extension]) return EXTENSION_MIMETYPE[extension];
  }
  return DEFAULT_MIMETYPE[mediaType];
}

function requireCreds(creds: WahaCreds): void {
  if (!creds?.baseUrl || !creds?.apiKey) {
    throw new Error("WAHA credentials are not configured for this clinic");
  }
}

async function postToWaha(
  creds: WahaCreds,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  requireCreds(creds);

  const response = await fetch(`${creds.baseUrl}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": creds.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WAHA send failed (${response.status}): ${error}`);
  }

  // O id devolvido é o mesmo que volta no webhook com fromMe:true — é ele que
  // permite descartar o echo da própria IA em vez de tratá-lo como mensagem
  // do operador.
  try {
    const data = (await response.json()) as { id?: string | { _serialized?: string } };
    if (typeof data.id === "string") return data.id;
    if (data.id && typeof data.id === "object") return data.id._serialized ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function sendWahaTextMessage(
  phone: string,
  text: string,
  creds: WahaCreds,
): Promise<string | null> {
  return postToWaha(creds, "sendText", {
    session: creds.session,
    chatId: toWahaChatId(phone),
    text,
  });
}

export async function sendWahaMediaMessage(
  phone: string,
  mediaUrl: string,
  mediaType: MediaType,
  creds: WahaCreds,
  caption?: string,
  fileName?: string,
): Promise<string | null> {
  const file: Record<string, unknown> = {
    url: mediaUrl,
    mimetype: resolveWahaMimetype(mediaUrl, mediaType, fileName),
  };
  if (fileName) file.filename = fileName;

  const payload: Record<string, unknown> = {
    session: creds.session,
    chatId: toWahaChatId(phone),
    file,
  };
  if (caption) payload.caption = caption;

  return postToWaha(creds, WAHA_MEDIA_ENDPOINT[mediaType], payload);
}

export type WahaSessionStatus = {
  name: string;
  status: string;
  connected: boolean;
};

/**
 * Saúde da sessão. Diferente da Z-API, ninguém reconecta por nós: se a sessão
 * cair, ela fica caída até alguém agir. É isto que o alerta de canal consulta.
 */
export async function getWahaSessionStatus(creds: WahaCreds): Promise<WahaSessionStatus> {
  requireCreds(creds);

  const response = await fetch(`${creds.baseUrl}/api/sessions/${creds.session}`, {
    headers: { "X-Api-Key": creds.apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WAHA session status failed (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { name?: string; status?: string };
  const status = data.status ?? "UNKNOWN";
  return {
    name: data.name ?? creds.session,
    status,
    connected: status === "WORKING",
  };
}
