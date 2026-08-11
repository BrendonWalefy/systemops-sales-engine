import type { TemplateManifest } from "@/application/templates/contract";

/**
 * Valida um TemplateManifest contra as regras de coerência do contrato de
 * templates (`contract.ts`). Cada regra existe porque, sem ela, o defeito só
 * aparece em runtime — na instalação de uma clínica real — em vez de aparecer
 * no momento em que o manifesto é escrito.
 *
 * Coleta TODOS os problemas em vez de retornar no primeiro: quem escreve o
 * manifesto corrige tudo numa passada só, em vez de um erro por rodada de
 * ida e volta.
 *
 * @returns lista de descrições de problema, vazia quando o manifesto é válido.
 *   Cada mensagem cita a chave (placeholder, variante ou slug) que causou o
 *   problema, para que o autor a encontre sem precisar ler este arquivo.
 */
export function validateManifest(manifest: TemplateManifest): string[] {
  const issues: string[] = [];

  const declaredKeys = new Set(manifest.placeholders.map((p) => p.key));
  const variantSlugs = new Set(manifest.variants.map((v) => v.slug));
  const usedKeys = new Set<string>();

  // --- Variantes: toda referência a placeholder precisa existir em
  // `placeholders`, e o canal "media" exige mediaAssetPlaceholder. Esta
  // última checagem é defesa em profundidade: o union discriminado de
  // TemplateVariant já barra o caso em compilação, mas um manifesto montado
  // dinamicamente (ou mutado, como via cast) passa direto pelo compilador.
  for (const variant of manifest.variants) {
    usedKeys.add(variant.displayNamePlaceholder);
    if (!declaredKeys.has(variant.displayNamePlaceholder)) {
      issues.push(
        `A variante "${variant.slug}" referencia o placeholder "${variant.displayNamePlaceholder}" em displayNamePlaceholder, mas ele não está declarado em placeholders.`,
      );
    }

    if (variant.priceChannel === "media") {
      const mediaKey = variant.mediaAssetPlaceholder;
      if (!mediaKey) {
        issues.push(
          `A variante "${variant.slug}" usa priceChannel "media" mas não declara mediaAssetPlaceholder.`,
        );
      } else {
        usedKeys.add(mediaKey);
        if (!declaredKeys.has(mediaKey)) {
          issues.push(
            `A variante "${variant.slug}" referencia o placeholder "${mediaKey}" em mediaAssetPlaceholder, mas ele não está declarado em placeholders.`,
          );
        }
      }
    }
  }

  // --- Objeções: appliesToVariant precisa apontar para uma variante
  // definida; {{key}} dentro do texto da resposta conta como uso.
  for (const objection of manifest.objections) {
    if (objection.appliesToVariant && !variantSlugs.has(objection.appliesToVariant)) {
      issues.push(
        `A objeção "${objection.objection}" aponta para a variante "${objection.appliesToVariant}" em appliesToVariant, que não está definida em variants.`,
      );
    }
    for (const key of extractPlaceholderKeys(objection.response)) {
      usedKeys.add(key);
    }
  }

  // --- Perguntas de qualificação e motivos de handoff: {{key}} conta como uso.
  for (const question of manifest.qualificationQuestions) {
    for (const key of extractPlaceholderKeys(question)) {
      usedKeys.add(key);
    }
  }

  for (const reason of manifest.handoffReasons) {
    for (const key of extractPlaceholderKeys(reason)) {
      usedKeys.add(key);
    }
  }

  // --- Placeholders declarados: órfão (declarado mas nunca usado) e
  // "defaulted" sem defaultValue (a instalação não tem o que preencher).
  for (const placeholder of manifest.placeholders) {
    if (!usedKeys.has(placeholder.key)) {
      issues.push(
        `O placeholder "${placeholder.key}" está declarado em placeholders mas não é usado em nenhuma variante, objeção, pergunta de qualificação ou motivo de handoff.`,
      );
    }
    if (placeholder.kind === "defaulted" && placeholder.defaultValue === undefined) {
      issues.push(
        `O placeholder "${placeholder.key}" é do tipo "defaulted" mas não declara defaultValue.`,
      );
    }
  }

  return issues;
}

/** Extrai as chaves de todo `{{key}}` presente no texto. */
function extractPlaceholderKeys(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1]);
}
