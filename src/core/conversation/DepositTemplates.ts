// Templates determinísticos do fluxo de sinal (depósito Pix). Nada aqui passa pela
// LLM: são textos fixos compostos de fatos estruturados da clínica — a regra do
// produto é que a IA NUNCA improvisa dinheiro nem valida comprovante.

export type DepositClinic = {
  depositAmountCents?: number | null;
  depositPixKey?: string | null;
  depositPixKeyType?: "cnpj" | "cpf" | "email" | "phone" | "random" | null;
  depositRecipientName?: string | null;
  depositTtlHours?: number;
  depositNotes?: string | null;
  depositConfirmationNotes?: string | null;
  address?: string | null;
};

function formatBrl(cents: number): string {
  const reais = cents / 100;
  const isRound = cents % 100 === 0;
  return `R$ ${reais.toLocaleString("pt-BR", {
    minimumFractionDigits: isRound ? 0 : 2,
    maximumFractionDigits: isRound ? 0 : 2,
  })}`;
}

function pixKeyLabel(type: DepositClinic["depositPixKeyType"]): string {
  switch (type) {
    case "cnpj": return "Chave Pix (CNPJ)";
    case "cpf": return "Chave Pix (CPF)";
    case "email": return "Chave Pix (e-mail)";
    case "phone": return "Chave Pix (telefone)";
    default: return "Chave Pix";
  }
}

function ttlLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "24 horas" : `${days} dias`;
  }
  return `${hours} horas`;
}

// Pedido de sinal enviado logo após o lead escolher o slot.
export function buildDepositRequestMessage(clinic: DepositClinic, slotLabel: string): string {
  const amount = clinic.depositAmountCents ? formatBrl(clinic.depositAmountCents) : "o sinal";
  const keyLine = clinic.depositPixKey ? `${pixKeyLabel(clinic.depositPixKeyType)}: ${clinic.depositPixKey}` : "";
  const recipientLine = clinic.depositRecipientName ? `Nome: ${clinic.depositRecipientName}` : "";
  const notes = clinic.depositNotes?.trim() ? `\n${clinic.depositNotes.trim()}` : "";
  const ttl = ttlLabel(clinic.depositTtlHours ?? 24);

  return [
    `Perfeito! Deixei o horário de ${slotLabel} reservado provisoriamente para você. 😊`,
    "",
    `Para CONFIRMAR o agendamento, pedimos um sinal de ${amount} via Pix:`,
    "",
    keyLine,
    recipientLine,
    notes,
    "",
    `Assim que fizer o Pix, envie o comprovante (foto ou PDF) aqui nesta conversa. O horário fica reservado por ${ttl} — o agendamento só é confirmado após a comprovação do envio do sinal.`,
  ]
    .filter((l) => l !== "" || true) // mantém linhas em branco intencionais
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Confirmação de que o comprovante chegou (enquanto a equipe valida).
export function buildDepositProofReceivedMessage(): string {
  return "Recebemos seu comprovante! 🙏 Nossa equipe vai conferir e em breve você recebe a confirmação do agendamento por aqui.";
}

// Confirmação final do agendamento — enviada pelo operador após validar o comprovante.
export function buildDepositConfirmationMessage(clinic: DepositClinic, slotLabel: string): string {
  const addressLine = clinic.address?.trim() ? `📍 ${clinic.address.trim()}` : "";
  const notes = clinic.depositConfirmationNotes?.trim()
    ? `\nOrientações importantes:\n${clinic.depositConfirmationNotes.trim()}`
    : "";
  return [
    "✅ Agendamento confirmado!",
    "",
    `📅 ${slotLabel}`,
    addressLine,
    notes,
    "",
    "Qualquer dúvida, é só chamar por aqui. Até lá! 😊",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Reserva expirou sem comprovante — enviada pelo cron de expiração.
export function buildDepositExpiredMessage(): string {
  return "Oi! O horário que estava reservado aguardando o sinal expirou e foi liberado. Se ainda quiser agendar, me avisa por aqui que eu verifico os horários disponíveis. 😊";
}

// Lead diz que pagou mas não anexou o comprovante.
export function buildDepositProofMissingMessage(): string {
  return "Que ótimo! Só não recebi o comprovante por aqui ainda — pode enviar a foto ou o PDF do Pix nesta conversa? Assim que chegar, seguimos com a confirmação. 🙏";
}
