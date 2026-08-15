import type {
  AuthorizedResponsePlan,
  ResponsePlanViolationCode,
} from "@/core/conversation/response-plan";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { ComposedResponse, ResponsePart } from "@/core/intelligence/ResponseComposer";

/**
 * Violações que dizem respeito à FORMA, não ao conteúdo autorizado.
 *
 * A distinção é o ponto: preço, horário, mídia e garantia não autorizados são
 * falhas de segurança — a IA afirmou algo que ninguém liberou, e descartar é a
 * única resposta correta. Tamanho e número de perguntas são falhas de estilo: o
 * conteúdo passou por todas as travas de fato e só ficou comprido.
 *
 * Tratar as duas com a mesma pena custava a resposta inteira. Medido no corpus
 * real em 13/08: 23 de 51 turnos violaram o plano, todas por estilo, e todas
 * terminaram com o lead recebendo "vou chamar nossa equipe".
 */
const STYLE_VIOLATIONS = new Set<ResponsePlanViolationCode>([
  "response_too_long",
  "too_many_questions",
]);

/**
 * Tenta salvar uma resposta reprovada só por estilo, cortando-a no fim de uma
 * frase até caber no plano. Devolve null quando o reparo não se aplica ou não
 * resolve — aí o fallback atual segue valendo.
 *
 * Seguro por construção: o prefixo de um texto cujos fatos já eram autorizados
 * continua autorizado, e o resultado é revalidado antes de sair daqui.
 */
export function repairStyleViolations(input: {
  response: ComposedResponse;
  plan: AuthorizedResponsePlan;
  violations: readonly ResponsePlanViolationCode[];
}): ComposedResponse | null {
  if (input.violations.length === 0) return null;
  if (!input.violations.every((code) => STYLE_VIOLATIONS.has(code))) return null;

  const parts = fitPartsToBudget(input.response.parts, input.plan.maxCharacters);
  if (!parts) return null;

  // Mesmo invariante que o composer usa ao montar a resposta: o texto é a
  // junção dos blocos de texto, e `mediaIds` descreve exatamente as mídias
  // presentes nas parts. Recalcular os três juntos impede que o reparo prometa
  // um arquivo que não vai ser entregue.
  const repaired: ComposedResponse = {
    ...input.response,
    text: textOf(parts),
    parts,
    mediaIds: parts.flatMap((part) => (part.type === "media" ? [part.id] : [])),
  };

  return validateComposedResponse({ plan: input.plan, response: repaired }).ok
    ? repaired
    : null;
}

function textOf(parts: readonly ResponsePart[]): string {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.content] : []))
    .join("\n\n")
    .trim();
}

/**
 * Corta os blocos de texto até caberem no orçamento, preservando a ordem e
 * **todas** as mídias.
 *
 * Mídia autorizada não é estilo: o pipeline já liberou aquele arquivo, e sumir
 * com ele para encurtar a resposta seria trocar uma falha de forma por uma de
 * conteúdo. Por isso as legendas consomem o orçamento primeiro — o que sobra é
 * o que o texto pode ocupar.
 */
function fitPartsToBudget(
  parts: readonly ResponsePart[],
  maxCharacters: number,
): ResponsePart[] | null {
  const captionBudget = parts.reduce(
    (total, part) =>
      part.type === "media" ? total + (part.caption?.trim().length ?? 0) : total,
    0,
  );

  const fitted: ResponsePart[] = [];
  let usedByText = 0;
  let textBlocks = 0;

  for (const part of parts) {
    if (part.type === "media") {
      fitted.push(part);
      continue;
    }

    // `text` junta os blocos com "\n\n"; o separador conta no orçamento.
    const separator = textBlocks > 0 ? 2 : 0;
    const available = maxCharacters - captionBudget - usedByText - separator;
    if (available <= 0) continue;

    const content = part.content.trim();
    if (!content) continue;

    const kept = content.length <= available
      ? content
      : truncateAtSentence(content, available);
    if (!kept) continue;

    fitted.push({ type: "text", content: kept });
    usedByText += kept.length + separator;
    textBlocks += 1;
  }

  return textBlocks > 0 ? fitted : null;
}

/** Maior prefixo que termina em pontuação final e cabe no limite. */
function truncateAtSentence(text: string, maxCharacters: number): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  if (normalized.length <= maxCharacters) return normalized;

  const window = normalized.slice(0, maxCharacters);
  const lastBreak = Math.max(
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
  );
  if (lastBreak < 0) return null;

  const candidate = window.slice(0, lastBreak + 1).trim();
  return candidate.length > 0 ? candidate : null;
}
