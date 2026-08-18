/**
 * O nome de exibição do WhatsApp em módulo próprio, e não dentro do
 * ConversationOrchestrator, porque o ResponseComposer precisa aplicá-lo antes de
 * interpolar o nome no system prompt — e importar o orquestrador de dentro do
 * composer fecharia um ciclo.
 */
// Retorna apenas o primeiro nome do lead para saudações — evita usar nome completo
// ou apelidos de contato como "Tânia Mara/Sinal Verde" na conversa.
// Guard: rejeita nomes de WhatsApp que não são nomes próprios de pessoa:
// frases religiosas ("Deus Ele É Deus."), siglas, nomes de negócios, etc.
export function extractFirstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const first = fullName.split(/[\s\/]+/)[0] ?? null;
  if (!first) return null;

  // Menos de 2 caracteres → sem sentido como nome
  if (first.replace(/\./g, "").length < 2) return null;

  // O nome de exibição é escolhido pelo dono do número e é interpolado no system
  // prompt sem fence — é a única string controlada pelo atacante nessa posição.
  // Tomar só o primeiro token já corta injeção com espaço ou quebra de linha,
  // mas não cobre um token único como "João:IGNORE_AS_REGRAS". Nenhum nome de
  // pessoa carrega pontuação de estrutura de prompt, nem passa de 40 caracteres.
  if (first.length > 40) return null;
  const PROMPT_STRUCTURE_CHARS_RE = /[:#*`~<>[\]{}|\\=]/;
  if (PROMPT_STRUCTURE_CHARS_RE.test(first)) return null;

  const cleanFirst = first.replace(/\./g, "");

  // Nomes de perfil com números não são tratados como nomes pessoais válidos (ex: "LOJA123")
  if (/\d/.test(cleanFirst)) return null;

  // Token precisa ter ao menos uma letra "de nome" (não pode ser só emoji/pontuação/
  // decoração), senão "🌻✨" ou "★" viraria saudação. Exige 2+ letras latinas.
  const letters = cleanFirst.match(/[A-Za-zÀ-ÿ]/g);
  if (!letters || letters.length < 2) return null;

  // Prefixos que indicam não ser nome de pessoa: religiosos, negócios, títulos
  const INVALID_FIRST_NAME_PREFIX_RE =
    /^(deus|senhor|sra?|nosso|loja|empresa|grupo|barbearia|clinica|clínica|salao|salão|studio|estudio|escritório|escritorio|atendimento|dr|dra)/i;
  if (INVALID_FIRST_NAME_PREFIX_RE.test(cleanFirst)) return null;

  // Palavras comuns / status de WhatsApp que não são nome próprio. O nome de exibição
  // do WhatsApp é livre — leads reais aparecem como "ocupado", "Seja Forte", "trabalho",
  // "2D". Saudar "Boa tarde, ocupado" soa robótico; melhor saudar sem nome. Casos reais
  // do histórico Vitalli: "ocupado", "Seja Forte E Corajoso", "2D".
  const COMMON_WORD_NAMES = new Set([
    "ocupado", "ocupada", "disponivel", "disponível", "trabalho", "trabalhando",
    "vida", "paz", "amor", "fe", "fé", "deus", "casa", "sim", "nao", "não",
    "seja", "eu", "voce", "você", "gente", "amigo", "amiga", "cliente",
  ]);
  if (COMMON_WORD_NAMES.has(cleanFirst.toLowerCase())) return null;

  return first;
}
