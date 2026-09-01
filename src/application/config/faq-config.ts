import { z } from "zod";

const unsafeDisplayControlPattern = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const normalizedText = (max: number) => z.string()
  .trim()
  .min(1)
  .max(max)
  .refine((value) => !unsafeDisplayControlPattern.test(value), "texto contém caractere inválido")
  .refine((value) => value === value.replace(/\s+/gu, " "), "texto deve usar espaços normalizados");

export const frequentlyAskedQuestionSchema = z.object({
  question: normalizedText(120),
  answer: normalizedText(240),
}).strict();

export const frequentlyAskedQuestionsSchema = z.array(frequentlyAskedQuestionSchema)
  .max(20, "no máximo 20 perguntas frequentes")
  .superRefine((faqs, context) => {
    const questions = new Set<string>();
    faqs.forEach((faq, index) => {
      const normalized = faq.question.normalize("NFKC").toLocaleLowerCase("pt-BR");
      if (questions.has(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "question"],
          message: "pergunta frequente duplicada",
        });
      }
      questions.add(normalized);
    });
  });

export type FrequentlyAskedQuestion = Readonly<z.infer<typeof frequentlyAskedQuestionSchema>>;

export function parseFrequentlyAskedQuestions(
  input: readonly { question?: string | null; answer?: string | null }[] | null | undefined,
): FrequentlyAskedQuestion[] {
  const normalized = (input ?? []).map((faq) => ({
    question: faq.question?.trim() ?? "",
    answer: faq.answer?.trim() ?? "",
  })).filter((faq) => faq.question.length > 0 || faq.answer.length > 0);

  if (normalized.some((faq) => faq.question.length === 0 || faq.answer.length === 0)) {
    throw new Error("pergunta frequente incompleta");
  }
  return frequentlyAskedQuestionsSchema.parse(normalized);
}
