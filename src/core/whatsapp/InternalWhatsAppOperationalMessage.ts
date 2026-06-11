import { areEquivalentWhatsAppPhones } from "./WhatsAppContactIdentity";

const INTERNAL_OPERATIONAL_PATTERNS = [
  ["precisa de voce", "acesse o inbox para responder"],
  ["responda neste chat", "sera encaminhada automaticamente ao lead"],
];

function normalizeOperationalText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isInternalOperationalWhatsAppMessage(params: {
  senderPhone: string | null | undefined;
  receptionistPhone: string | null | undefined;
  messageText: string | null | undefined;
}): boolean {
  const { senderPhone, receptionistPhone, messageText } = params;
  if (!messageText?.trim()) return false;

  if (!areEquivalentWhatsAppPhones(senderPhone, receptionistPhone)) return false;

  const normalizedText = normalizeOperationalText(messageText);
  return INTERNAL_OPERATIONAL_PATTERNS.some((pattern) =>
    pattern.every((marker) => normalizedText.includes(marker)),
  );
}
