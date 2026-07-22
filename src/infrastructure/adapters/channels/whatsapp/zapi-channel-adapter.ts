import type {
  ChannelAdapter,
  IncomingChannelMessage,
  MediaType,
  OutgoingChannelMessage,
} from "@/application/ports/channel-adapter";

/**
 * Z-API webhook payload
 * Docs: https://developer.z-api.io/webhooks/on-message-received
 */
export type ZApiInboundPayload = {
  phone: string;
  chatLid?: string | null;
  instanceId: string;
  messageId: string;
  momment?: number; // Z-API typo — kept as-is
  status?: string;
  chatName?: string;
  senderName?: string;
  senderPhoto?: string;
  text?: { message: string };
  audio?: { audioUrl: string; mimeType: string; seconds?: number };
  image?: { imageUrl: string; caption?: string; mimeType: string };
  video?: { videoUrl: string; caption?: string; mimeType: string };
  document?: { documentUrl: string; fileName: string; mimeType: string };
  sticker?: { stickerUrl: string; mimeType: string };
  reaction?: { emoji?: string; reaction?: string; text?: string; message?: string };
  buttonsResponseMessage?: {
    buttonId?: string;
    selectedButtonId?: string;
    selectedDisplayText?: string;
    message?: string;
  };
  buttonReply?: {
    id?: string;
    title?: string;
    text?: string;
  };
  interactive?: {
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
  };
  buttonId?: string;
  selectedButtonId?: string;
  selectedDisplayText?: string;
  reactionText?: string;
  emoji?: string;
  isGroupMsg?: boolean;
  isStatusReply?: boolean;
  isEdit?: boolean;
  fromMe?: boolean;
};

export class ZApiChannelAdapter implements ChannelAdapter {
  constructor(
    private readonly creds: { instanceId: string; token: string; clientToken?: string },
  ) {}

  async receive(payload: unknown): Promise<IncomingChannelMessage> {
    const data = payload as ZApiInboundPayload;
    const { mediaUrl, mediaType } = resolveZApiMedia(data);

    return {
      channel: "whatsapp",
      externalContactId: data.phone,
      externalThreadId: data.phone,
      externalMessageId: data.messageId,
      name: data.senderName || null,
      senderPhoto: data.senderPhoto ?? null,
      phone: data.phone,
      whatsappLid: data.chatLid ?? null,
      email: null,
      body: data.text?.message ?? data.image?.caption ?? data.video?.caption ?? "",
      mediaUrl,
      mediaType,
      receivedAt: data.momment ? new Date(data.momment) : new Date(),
      campaignId: null,
    };
  }

  async send(message: OutgoingChannelMessage): Promise<void> {
    if (message.mediaUrl && message.mediaType) {
      await sendZApiMediaMessage(message.externalThreadId, message.mediaUrl, message.mediaType, this.creds, message.mediaCaption);
    } else {
      await sendZApiTextMessage(message.externalThreadId, message.body, this.creds);
    }
  }
}

export async function sendZApiTextMessage(
  phone: string,
  text: string,
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<string | null> {
  const instanceId = creds.instanceId;
  const token = creds.token;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http")
    ? rawClientToken
    : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message: text }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z-API send failed (${response.status}): ${error}`);
  }

  // Z-API returns { zaapId, messageId } — messageId matches the webhook fromMe payload
  try {
    const data = await response.json() as { messageId?: string; zaapId?: string };
    return data.messageId ?? data.zaapId ?? null;
  } catch {
    return null;
  }
}

/**
 * Envia texto COM card de pré-visualização. Endpoint separado de propósito na
 * Z-API: o `send-text` não monta prévia nenhuma, e o card não é derivado da URL —
 * quem fornece título, descrição e imagem somos nós.
 *
 * A doc exige que o link seja a última coisa da mensagem; quem chama garante isso.
 */
export async function sendZApiLinkMessage(
  phone: string,
  text: string,
  link: { linkUrl: string; title: string; linkDescription: string; image: string },
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<string | null> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-link`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone,
        message: text,
        linkUrl: link.linkUrl,
        title: link.title,
        linkDescription: link.linkDescription,
        image: link.image,
        linkType: "LARGE",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Z-API send-link failed (${response.status}): ${await response.text()}`);
  }

  try {
    const data = (await response.json()) as { messageId?: string; zaapId?: string };
    return data.messageId ?? data.zaapId ?? null;
  } catch {
    return null;
  }
}

export type ZApiButton = {
  id: string;
  label: string;
};

export async function sendZApiButtonListMessage(
  phone: string,
  text: string,
  buttons: ZApiButton[],
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<string | null> {
  const instanceId = creds.instanceId;
  const token = creds.token;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http")
    ? rawClientToken
    : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }
  if (!text.trim()) throw new Error("Z-API button message cannot be empty");
  if (buttons.length === 0) throw new Error("Z-API button list requires at least one button");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-button-list`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone,
        message: text,
        buttonList: {
          buttons: buttons.map((button) => ({ id: button.id, label: button.label })),
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z-API send-button-list failed (${response.status}): ${error}`);
  }

  try {
    const data = await response.json() as { messageId?: string; zaapId?: string; id?: string };
    return data.messageId ?? data.id ?? data.zaapId ?? null;
  } catch {
    return null;
  }
}

const ZAPI_MEDIA_ENDPOINT: Record<string, string> = {
  audio: "send-audio",
  image: "send-image",
  video: "send-video",
  document: "send-document",
};

const ZAPI_MEDIA_BODY_KEY: Record<string, string> = {
  audio: "audio",
  image: "image",
  video: "video",
  document: "document",
};

// Erros 5xx ou de rede são transientes — vale 1 retry com backoff curto.
// Erros 4xx (payload inválido, credenciais, URL inacessível) são permanentes — não retentar.
function isTransientZApiError(status: number): boolean {
  return status >= 500 || status === 429;
}

export async function sendZApiMediaMessage(
  phone: string,
  mediaUrl: string,
  mediaType: MediaType,
  creds: { instanceId: string; token: string; clientToken?: string },
  caption?: string,
  fileName?: string,
): Promise<string | null> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  if (!instanceId || !token) {
    throw new Error("Z-API instance ID and token must be configured for this clinic");
  }

  const documentName = fileName ?? caption;
  const documentExtension = mediaType === "document"
    ? resolveDocumentExtension(mediaUrl, documentName)
    : null;
  const endpoint = mediaType === "document"
    ? `${ZAPI_MEDIA_ENDPOINT[mediaType]}/${documentExtension}`
    : ZAPI_MEDIA_ENDPOINT[mediaType];
  const bodyKey = ZAPI_MEDIA_BODY_KEY[mediaType];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;

  const payload: Record<string, unknown> = { phone, [bodyKey]: mediaUrl };
  if (caption) payload.caption = caption;
  if (mediaType === "document" && documentName) payload.fileName = documentName;

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;
  const requestBody = JSON.stringify(payload);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1_500));

    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: requestBody });
    } catch (networkErr) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      console.warn(`[ZApi] send-${mediaType} erro de rede (tentativa ${attempt + 1}/2):`, lastError.message);
      continue;
    }

    if (!response.ok) {
      const error = await response.text();
      if (!isTransientZApiError(response.status)) {
        throw new Error(`Z-API send-${mediaType} failed (${response.status}): ${error}`);
      }
      lastError = new Error(`Z-API send-${mediaType} failed (${response.status}): ${error}`);
      console.warn(`[ZApi] send-${mediaType} erro transiente ${response.status} (tentativa ${attempt + 1}/2) — retentando`);
      continue;
    }

    try {
      const data = await response.json() as { messageId?: string; zaapId?: string };
      return data.messageId ?? data.zaapId ?? null;
    } catch {
      return null;
    }
  }

  throw lastError ?? new Error(`Z-API send-${mediaType} falhou após 2 tentativas`);
}

function resolveDocumentExtension(mediaUrl: string, fileName?: string): string {
  const candidates = [fileName, mediaUrl];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const withoutQuery = candidate.split(/[?#]/)[0];
    const match = withoutQuery.match(/\.([a-zA-Z0-9]{1,10})$/);
    if (match) return match[1].toLowerCase();
  }
  return "pdf";
}

// Status de entrega de uma mensagem já aceita pela Z-API.
// O ACK do POST de envio significa "na fila" — mídia enviada por URL ainda será
// baixada pela Z-API antes de chegar ao WhatsApp. Este endpoint permite saber
// quando a mensagem realmente saiu, viabilizando entrega ordenada.
//
// "delivered"   → SENT/RECEIVED/READ/PLAYED — já saiu da fila, próxima parte pode ir
// "pending"     → ainda na fila da Z-API — aguardar
// "unsupported" → endpoint indisponível ou resposta irreconhecível — não insistir
export type ZApiDeliveryStatus = "delivered" | "pending" | "unsupported";
export type ZApiInstanceStatus = {
  connected?: boolean;
  smartphoneConnected?: boolean;
  error?: string;
};

const ZAPI_DELIVERED_STATUSES = new Set(["SENT", "RECEIVED", "READ", "PLAYED", "DELIVERED", "VIEWED"]);
const ZAPI_PENDING_STATUSES = new Set(["PENDING", "QUEUED", "WAITING", "PROCESSING"]);

export async function getZApiMessageDeliveryStatus(
  messageId: string,
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<ZApiDeliveryStatus> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;
  if (!instanceId || !token) return "unsupported";

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/message-status/${encodeURIComponent(messageId)}`,
      { method: "GET", headers, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return "unsupported";

    const data = (await response.json()) as { status?: unknown } | { status?: unknown }[] | null;
    const rawStatus = Array.isArray(data) ? data.at(-1)?.status : data?.status;
    if (typeof rawStatus !== "string") return "unsupported";

    const status = rawStatus.toUpperCase();
    if (ZAPI_DELIVERED_STATUSES.has(status)) return "delivered";
    if (ZAPI_PENDING_STATUSES.has(status)) return "pending";
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

export async function getZApiInstanceStatus(
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<ZApiInstanceStatus> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;
  if (!instanceId || !token) {
    return { connected: false, smartphoneConnected: false, error: "Missing instanceId or token" };
  }

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/status`,
      { method: "GET", headers, signal: AbortSignal.timeout(5_000) },
    );

    const text = await response.text();
    if (!response.ok) {
      return {
        connected: false,
        smartphoneConnected: false,
        error: text || `HTTP ${response.status}`,
      };
    }

    try {
      const data = JSON.parse(text) as ZApiInstanceStatus;
      return data;
    } catch {
      return { connected: false, smartphoneConnected: false, error: "Invalid Z-API status response" };
    }
  } catch (error) {
    return {
      connected: false,
      smartphoneConnected: false,
      error: error instanceof Error ? error.message : "Unknown Z-API status error",
    };
  }
}

function resolveZApiMedia(data: ZApiInboundPayload): { mediaUrl: string | null; mediaType: MediaType | null } {
  if (data.audio) return { mediaUrl: data.audio.audioUrl, mediaType: "audio" };
  if (data.image) return { mediaUrl: data.image.imageUrl, mediaType: "image" };
  if (data.video) return { mediaUrl: data.video.videoUrl, mediaType: "video" };
  if (data.document) return { mediaUrl: data.document.documentUrl, mediaType: "document" };
  return { mediaUrl: null, mediaType: null };
}

// ─── Pareamento por QR / código de telefone ───────────────────────────────────
//
// Usados pelo fluxo de onboarding no portal (P0.5). O token da clínica NUNCA
// é serializado na resposta ao client — o backend chama estas funções e entrega
// apenas o base64/código/status ao front-end.
//
// Credenciais SEMPRE passadas por parâmetro (resolveChannelConfig no caller),
// nunca lidas de env.

export type ZApiQrCodeResult =
  | { status: "qr"; base64: string }
  | { status: "connected" }
  | { status: "expired" }
  | { status: "error"; message: string };

/**
 * Busca o QR code da instância Z-API em base64.
 * Endpoints Z-API: GET .../qr-code/image
 * - 200 com campo `value` (base64) → QR disponível.
 * - 200 com `value = null` / `connected = true` → já conectado.
 * - 4xx ou `value` ausente → QR expirado ou instância não inicializada.
 */
export async function getZApiQrCodeImage(
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<ZApiQrCodeResult> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  if (!instanceId || !token) {
    return { status: "error", message: "Missing instanceId or token" };
  }

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/qr-code/image`,
      { method: "GET", headers, signal: AbortSignal.timeout(10_000) },
    );

    if (!response.ok) {
      // 4xx → instância não inicializada ou QR expirado
      return { status: "expired" };
    }

    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = null; }

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      // Já conectado: { connected: true } ou { value: null }
      if (obj.connected === true) return { status: "connected" };
      // QR disponível: { value: "<base64>" }
      if (typeof obj.value === "string" && obj.value.length > 0) {
        return { status: "qr", base64: obj.value };
      }
    }

    // value vazio ou formato inesperado → expirado / não disponível
    return { status: "expired" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}

// ─── Provisionamento automático de instância (parceiro integrador) ────────────
//
// Usados pela rota de onboarding do owner para criar a instância Z-API sem
// abrir o painel deles. Auth nas rotas de parceiro é `Authorization: Bearer
// <partnerToken>` — SEM Client-Token e sem instanceId/token na URL (a instância
// ainda não existe). Docs: https://developer.z-api.io/partner/create-instance

export type ZApiCreateInstanceResult = {
  instanceId: string;
  token: string;
  due?: string;
};

/**
 * Cria uma instância nova já com o preset padrão embutido no body do create.
 * O que o create não cobre (notify-sent-by-me, filtro de grupos) é aplicado
 * em seguida por applyZApiInstancePreset.
 */
export async function createZApiInstance(
  name: string,
  partnerToken: string,
  webhookUrl: string,
): Promise<ZApiCreateInstanceResult> {
  const response = await fetch("https://api.z-api.io/instances/integrator/on-demand", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${partnerToken}`,
    },
    body: JSON.stringify({
      name,
      receivedCallbackUrl: webhookUrl,
      // false: com true, o Z-API marca a mensagem como lida via API assim que
      // chega e o multi-device sincroniza esse status pro celular do dono da
      // clínica quase na hora — em muitos aparelhos isso suprime o banner/som
      // de notificação, dando a impressão de que "parou de notificar".
      autoReadMessage: false,
      callRejectAuto: false,
      autoReadStatus: false,
      disableEnqueueWhenDisconnected: false,
      isDevice: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z-API create instance failed (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { id?: string; token?: string; due?: string };
  if (!data.id || !data.token) {
    throw new Error("Z-API create instance: resposta sem id/token");
  }

  return { instanceId: data.id, token: data.token, due: data.due };
}

/**
 * Aplica, após a criação, as duas configurações que o endpoint de create não
 * cobre: notificar mensagens enviadas pelo próprio celular (takeover) e
 * ignorar mensagens de grupo (FILTER_FROM_GROUP em messageFilters).
 * Docs: https://developer.z-api.io/webhooks/update-notify-sent-by-me
 *       https://developer.z-api.io/webhooks/update-filters
 */
export async function applyZApiInstancePreset(
  creds: { instanceId: string; token: string; clientToken?: string },
): Promise<void> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientToken) headers["Client-Token"] = clientToken;

  const notifySentByMe = fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/update-notify-sent-by-me`,
    { method: "PUT", headers, body: JSON.stringify({ notifySentByMe: true }) },
  );
  const ignoreGroups = fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/update-filters`,
    { method: "PUT", headers, body: JSON.stringify({ messageFilters: ["FILTER_FROM_GROUP"] }) },
  );

  const [notifyRes, groupsRes] = await Promise.all([notifySentByMe, ignoreGroups]);

  if (!notifyRes.ok) {
    const error = await notifyRes.text();
    throw new Error(`Z-API notify-sent-by-me failed (${notifyRes.status}): ${error}`);
  }
  if (!groupsRes.ok) {
    const error = await groupsRes.text();
    throw new Error(`Z-API update-filters failed (${groupsRes.status}): ${error}`);
  }
}

export type ZApiPhoneCodeResult =
  | { status: "code"; code: string }
  | { status: "connected" }
  | { status: "error"; message: string };

/**
 * Solicita o código de pareamento por número de telefone (sem câmera).
 * O código de 8 dígitos é digitado no WhatsApp em Dispositivos vinculados.
 * Endpoints Z-API: GET .../phone-code/{phone}
 */
export async function getZApiPhoneCode(
  creds: { instanceId: string; token: string; clientToken?: string },
  phone: string,
): Promise<ZApiPhoneCodeResult> {
  const { instanceId, token } = creds;
  const rawClientToken = creds.clientToken;
  const clientToken = rawClientToken && !rawClientToken.startsWith("http") ? rawClientToken : undefined;

  if (!instanceId || !token) {
    return { status: "error", message: "Missing instanceId or token" };
  }
  if (!phone || !/^\d{10,15}$/.test(phone.replace(/\D/g, ""))) {
    return { status: "error", message: "Número de telefone inválido" };
  }

  const headers: Record<string, string> = {};
  if (clientToken) headers["Client-Token"] = clientToken;

  const normalizedPhone = phone.replace(/\D/g, "");

  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/phone-code/${encodeURIComponent(normalizedPhone)}`,
      { method: "GET", headers, signal: AbortSignal.timeout(15_000) },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      return { status: "error", message: errText || `HTTP ${response.status}` };
    }

    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = null; }

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (obj.connected === true) return { status: "connected" };
      // Código retornado como `code` ou `pairingCode`
      const code = obj.code ?? obj.pairingCode;
      if (typeof code === "string" && code.length > 0) {
        return { status: "code", code };
      }
    }

    return { status: "error", message: "Resposta inesperada da Z-API" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}
