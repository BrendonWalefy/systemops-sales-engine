export function validateManualRecoveryRecipient(lead: {
  contactConsentRevokedAt: Date | null;
  phone: string | null;
  whatsappLid: string | null;
}): { ok: boolean; error?: string } {
  if (lead.contactConsentRevokedAt) {
    return {
      ok: false,
      error: "Este contato pediu para não receber mais mensagens. Envio bloqueado.",
    };
  }
  if (!lead.phone && !lead.whatsappLid) {
    return { ok: false, error: "Sem endereço WhatsApp válido" };
  }
  return { ok: true };
}
