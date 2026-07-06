export type StopContactDecision = {
  intent: string;
  shouldRevokeConsent: boolean;
  revokedAt: Date;
  source: "lead_message";
  confirmationText: string;
  attentionReason: string;
};

const STOP_CONTACT_CONFIRMATION =
  "Entendido, não vou mais te enviar mensagens por aqui. Se precisar de algo no futuro, é só me chamar. 🙏";
const STOP_CONTACT_ATTENTION_REASON = "Lead pediu para não receber mais mensagens (opt-out)";

export function resolveStopContactDecision(input: {
  classifiedIntent: string;
  messageText: string;
  now?: Date;
}): StopContactDecision | null {
  if (!shouldTreatAsStopContact(input.messageText, input.classifiedIntent)) return null;
  return {
    intent: "stop_contact",
    shouldRevokeConsent: true,
    revokedAt: input.now ?? new Date(),
    source: "lead_message",
    confirmationText: STOP_CONTACT_CONFIRMATION,
    attentionReason: STOP_CONTACT_ATTENTION_REASON,
  };
}

export function shouldTreatAsStopContact(messageText: string, classifiedIntent: string): boolean {
  const text = normalize(messageText);
  if (!text) return false;
  if (isStopContactNegative(text)) return false;
  if (hasExplicitStopContactPhrase(text)) return true;
  return classifiedIntent === "stop_contact" && hasContactOptOutSignal(text);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStopContactNegative(text: string): boolean {
  if (/^(nao|n|não)?\s*(quero|aceito)?\s*(esse|este)?\s*horario\b/.test(text)) return true;
  if (/\b(esse|este|essa|esta)\s+horario\b/.test(text)) return true;
  if (/\b(remarcar|remarca|trocar|mudar)\s+(o\s+)?horario\b/.test(text)) return true;
  if (/\b(nao quero|desisti|cancelar|cancelei)\b.*\b(tratamento|procedimento|consulta|avaliacao)\b/.test(text)) return true;
  if (/^(para|pare|parar)$/.test(text)) return true;
  if (/^(tchau|obrigad[oa]|valeu|ok|nao obrigado|agora nao)$/.test(text)) return true;
  return false;
}

function hasExplicitStopContactPhrase(text: string): boolean {
  return (
    /\b(nao quero|nao desejo)\s+mais\s+(receber|ganhar)\s+(mensagens?|msg|contato|chamadas?)\b/.test(text) ||
    /\b(para|pare|parar|parem)\s+de\s+(me\s+)?(mandar|enviar|chamar|mandar mensagem|enviar mensagem)\b/.test(text) ||
    /\b(nao|nunca)\s+(me\s+)?(manda|mande|mandem|envia|envie|enviem|chama|chame|chamem)\s+(mais\s+)?(mensagens?|msg|nada|aqui)?\b/.test(text) ||
    /\b(me\s+)?(tira|remova|remove)\s+(dessa|da|deste|desse)\s+(lista|base)\b/.test(text) ||
    /\b(sair|sai|quero sair)\s+(dessa|da|deste|desse)\s+(lista|base)\b/.test(text) ||
    /\b(descadastrar|descadastro|cancela(r)?\s+(o\s+)?recebimento)\b/.test(text) ||
    /\bnao\s+(me\s+)?(procura|procure|contata|contate|contacta|contacte)\s+mais\b/.test(text)
  );
}

function hasContactOptOutSignal(text: string): boolean {
  return (
    /\b(receber|mensagens?|msg|lista|descadastrar|contato|chamar|mandar|enviar|procura|contata)\b/.test(text) &&
    /\b(nao|pare|para|parar|sair|tira|remova|remove|descadastrar|cancela)\b/.test(text)
  );
}
