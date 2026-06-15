/**
 * Lint puro do campo `notes` — sem imports de servidor, utilizável em client components.
 *
 * Detecta quando `notes` está sendo usado como depósito de informações que pertencem
 * a campos estruturados. Retorna lista de avisos; nunca bloqueia publicação.
 */
export function lintPlaybookNotes(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const warnings: string[] = [];
  if (/R\$\s*[\d.,]+/.test(notes)) {
    warnings.push('Contém padrão de preço (R$). Preços pertencem ao campo Política Comercial.');
  }
  if (/parcel[ao]|entrada(?= em| de)|forma(?:s)? de pagamento/i.test(notes)) {
    warnings.push('Menciona condições de pagamento. Isso pertence ao campo Política Comercial.');
  }
  if (/\bobjeç[aã]o\b|desconto|(?:muito )?caro|barato/i.test(notes)) {
    warnings.push('Menciona objeções ou preço relativo. Use o campo Objeções para isso.');
  }
  return warnings;
}
