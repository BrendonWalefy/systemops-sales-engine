/**
 * Identidade de contato WhatsApp — telefone E.164 e/ou @lid (Linked ID).
 *
 * O WhatsApp pode enviar o contato como número, como @lid, ou ambos no mesmo
 * webhook (campo phone + chatLid). O sistema deve tratar os dois como o mesmo lead.
 */

export type WhatsAppContactIdentifiers = {
  /** Dígitos E.164, ex: 5511999999999 */
  phone: string | null;
  /** Identificador privado do WhatsApp, ex: 200000000000002@lid */
  whatsappLid: string | null;
};

export function isWhatsAppLid(value: string): boolean {
  return value.toLowerCase().includes("@lid");
}

export function normalizeWhatsAppPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

/**
 * Normalização para contatos digitados manualmente na agenda.
 * O painel brasileiro recebe com frequência DDD+número; o provedor exige DDI.
 * Números que já trazem DDI são preservados para não impedir clínicas de outros
 * países. O default fica explícito no call-site/configuração, nunca em env.
 */
export function normalizeManualWhatsAppPhone(
  raw: string,
  defaultCountryCode = "55",
): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (raw.trim().startsWith("+") || raw.trim().startsWith("00")) return digits;
  if (digits.length === 10 || digits.length === 11) {
    return `${defaultCountryCode}${digits}`;
  }
  return digits;
}

export function areEquivalentWhatsAppPhones(
  leftRaw: string | null | undefined,
  rightRaw: string | null | undefined,
): boolean {
  const left = normalizeWhatsAppPhone(leftRaw ?? "");
  const right = normalizeWhatsAppPhone(rightRaw ?? "");

  if (!left || !right) return false;
  if (left === right) return true;

  return left.endsWith(right) || right.endsWith(left);
}

export function parseWhatsAppContactField(
  raw: string | null | undefined,
): Partial<WhatsAppContactIdentifiers> {
  const trimmed = raw?.trim();
  if (!trimmed) return {};

  if (isWhatsAppLid(trimmed)) {
    return { whatsappLid: trimmed };
  }

  const phone = normalizeWhatsAppPhone(trimmed);
  return phone ? { phone } : {};
}

export function mergeContactIdentifiers(
  ...parts: Array<Partial<WhatsAppContactIdentifiers>>
): WhatsAppContactIdentifiers {
  let phone: string | null = null;
  let whatsappLid: string | null = null;

  for (const part of parts) {
    if (part.phone) phone = part.phone;
    if (part.whatsappLid) whatsappLid = part.whatsappLid;
  }

  return { phone, whatsappLid };
}

export function buildContactIdentifiersFromWebhook(params: {
  phone?: string | null;
  chatLid?: string | null;
}): WhatsAppContactIdentifiers {
  return mergeContactIdentifiers(
    parseWhatsAppContactField(params.phone),
    parseWhatsAppContactField(params.chatLid),
  );
}

/** Endereço para envio Z-API/Meta — prefere telefone quando disponível. */
export function resolveWhatsAppChannelAddress(ids: WhatsAppContactIdentifiers): string | null {
  return ids.phone ?? ids.whatsappLid;
}

/** Chave estável para thread externa (conversa WhatsApp). */
export function resolveWhatsAppThreadId(ids: WhatsAppContactIdentifiers): string | null {
  return resolveWhatsAppChannelAddress(ids);
}

export function hasWhatsAppIdentity(ids: WhatsAppContactIdentifiers): boolean {
  return ids.phone !== null || ids.whatsappLid !== null;
}

/** Expressa os identificadores conhecidos de um lead para lookup em SQL (phone OR lid). */
export function leadMatchesWhatsAppIdentifiers(
  lead: { phone: string | null; whatsappLid: string | null },
  identifiers: WhatsAppContactIdentifiers,
): boolean {
  if (identifiers.phone && lead.phone === identifiers.phone) return true;
  if (identifiers.whatsappLid && lead.whatsappLid === identifiers.whatsappLid) return true;
  // Compat: @lid ainda na coluna phone antes da migração.
  if (identifiers.whatsappLid && lead.phone === identifiers.whatsappLid) return true;
  return false;
}
