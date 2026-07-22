// Bloco de endereço determinístico — itens #22 e #23 do plano de correção.
//
// Antes existiam quatro montagens diferentes do endereço espalhadas pelo código,
// todas com a mesma linha `📍 Estamos na {address}.`: texto puro, sem complemento e
// sem link. O operador faz diferente à mão — separa o complemento em linha própria
// e manda o link do Google Maps, que o WhatsApp renderiza com foto do prédio.
//
// Nada aqui passa pela LLM: endereço é fato cadastrado. Se o campo não existe, a
// linha não sai — nunca inventamos complemento nem URL.

export type ClinicAddress = {
  address?: string | null;
  addressComplement?: string | null;
  mapsUrl?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Linhas do endereço, da mais para a menos importante. Vazio quando a clínica não
 * tem endereço cadastrado — o chamador decide o que dizer nesse caso.
 *
 * `withPin` liga o 📍 na primeira linha (respostas de conversa). A confirmação de
 * agendamento usa rótulo próprio e passa `false`.
 */
export function buildAddressLines(clinic: ClinicAddress, options?: { withPin?: boolean }): string[] {
  const address = clean(clinic.address);
  if (!address) return [];

  const lines = [options?.withPin === false ? address : `📍 ${address}`];

  const complement = clean(clinic.addressComplement);
  if (complement) lines.push(complement);

  // O link vai em linha própria de propósito: o WhatsApp só gera a
  // pré-visualização quando a URL não está grudada em outro texto.
  const mapsUrl = clean(clinic.mapsUrl);
  if (mapsUrl) lines.push(mapsUrl);

  return lines;
}

/** Resposta direta a "onde vocês ficam?". Vazio quando não há endereço cadastrado. */
export function buildAddressAnswer(clinic: ClinicAddress): string {
  const address = clean(clinic.address);
  if (!address) return "";
  const rest = buildAddressLines(clinic).slice(1);
  return [`📍 Estamos na ${address}.`, ...rest].join("\n");
}
