/**
 * Lint puro do campo `notes` — sem imports de servidor, utilizável em client components.
 *
 * Detecta quando `notes` está sendo usado como depósito de informações que pertencem
 * a campos estruturados. Retorna lista de avisos; nunca bloqueia publicação.
 */
export function lintPlaybookNotes(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const warnings: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(notes)) {
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

// Valor de preço CONCRETO: "R$" seguido (após espaços opcionais) de ao menos um
// dígito. Não casa "R$" solto nem "R$ para" — só um valor de fato.
const CONCRETE_PRICE_PATTERN = /R\$\s*\d[\d.,]*/;

/**
 * Subconjunto BLOQUEANTE do lint de `notes`: padrões que carregam um FATO com
 * casa estruturada e portanto não devem publicar. Diferente de `lintPlaybookNotes`
 * (avisos, nunca bloqueiam), estes TRAVAM a ativação do playbook.
 *
 * Mantido deliberadamente ESTREITO — só valor de preço concreto (R$ 2.500), cuja
 * casa é `commercialPolicy` / `treatments.priceCents`. Padrões mais fuzzy
 * (palavra "parcelamento", "desconto") continuam apenas como aviso, para não
 * bloquear orientação comportamental legítima que só menciona esses termos.
 */
export function blockingPlaybookNotesIssues(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const issues: string[] = [];
  if (CONCRETE_PRICE_PATTERN.test(notes)) {
    issues.push(
      'O campo de conduta (notes) contém um valor em R$. Preço pertence à Política Comercial — mova o valor para lá antes de publicar.',
    );
  }
  return issues;
}
