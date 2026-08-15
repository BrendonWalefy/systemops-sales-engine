import { z } from "zod";
import {
  deriveBetterResponder,
  deriveProseLabel,
  type ReviewChecklist,
} from "@/application/corpus/review-checklist";

/**
 * Um caso de corpus é a unidade de medida do programa: uma virada de conversa
 * com tudo que é preciso para julgá-la, e nada que identifique quem a viveu.
 *
 * Três propriedades sustentam o resto do ciclo:
 *
 * 1. **Versionado.** Um caso de versão desconhecida para a carga com o nome da
 *    versão. Schema que evolui em silêncio corrompe baseline sem avisar.
 * 2. **Derivado.** Rótulo de prosa e comparação IA × humano saem do checklist;
 *    quem tenta gravar outro valor é recusado no parse.
 * 3. **Sanitizado.** O caso entra no Git. PII que sobreviver aqui vaza para
 *    sempre, então o parse é a última barreira e ela é obrigatória.
 */

export const CORPUS_CASE_VERSION = "corpus-case.v1" as const;

/**
 * Jornadas do corpus. Não são intents nem uma taxonomia de entendimento — são
 * apenas o eixo de estratificação e o shard onde o caso vive. O vocabulário de
 * `request` é descoberto do corpus, e é outra coisa.
 */
export const CORPUS_JOURNEYS = [
  "first-contact",
  "price",
  "location",
  "procedure",
  "objection",
  "discount",
  "comparison",
  "availability",
  "handoff",
  "injection",
  "scheduling",
  "reschedule",
  "follow-up",
  "media",
  "burst",
  "audio",
  "ambiguity",
  "silence-recovery",
  "integration-error",
  // Balde declarado de sobra na amostragem. Existe para que a distribuição do
  // corpus não invente jornada onde só houve "nenhuma regra reconheceu isto".
  "other",
] as const;

export type Journey = (typeof CORPUS_JOURNEYS)[number];

export const DIALOGUE_MOVES = [
  "new_topic",
  "answers_pending",
  "acknowledges",
  "repeats",
  "closes",
] as const;

export type DialogueMove = (typeof DIALOGUE_MOVES)[number];

const checklistSchema = z
  .object({
    factuallyCorrect: z.boolean(),
    addressedWhatTheLeadRaised: z.boolean(),
    advancedTheJourney: z.boolean(),
    wouldRepeatToday: z.boolean(),
  })
  .strict();

const proseAssessmentSchema = z
  .object({
    checklist: checklistSchema,
    label: z.enum(["golden", "acceptable", "anti-pattern"]),
    rationale: z.string().trim().min(1),
  })
  .strict()
  .superRefine((assessment, ctx) => {
    const derived = deriveProseLabel(assessment.checklist as ReviewChecklist);
    if (derived !== assessment.label) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["label"],
        message: `label must be derived from the checklist: expected ${derived}, got ${assessment.label}`,
      });
    }
  });

/**
 * Eixos de entendimento. São **hipótese sob teste**, não taxonomia aprovada: o
 * ciclo C existe em parte para descobrir quais deles carregam sinal e quais
 * nunca são preenchidos. Por isso todos são opcionais por campo e nenhum tem
 * enum fechado além de `dialogueMove` — fechar vocabulário antes de medir é
 * exatamente o erro que a V1 cometeu com os 17 intents.
 */
const understandingSchema = z
  .object({
    // Slug em kebab-case. Livre de propósito: o vocabulário é descoberto, e o
    // índice do corpus reporta a distribuição encontrada.
    request: z.string().regex(/^[a-z][a-z0-9-]*$/, "request must be kebab-case"),
    dialogueMove: z.enum(DIALOGUE_MOVES),
    entities: z
      .object({
        date: z.string().optional(),
        period: z.string().optional(),
        time: z.string().optional(),
        service: z.string().optional(),
        serviceCandidates: z.array(z.string()).optional(),
        quantity: z.number().optional(),
        ordinal: z.number().optional(),
      })
      .strict(),
    signals: z
      .object({
        purchaseIntent: z.enum(["low", "medium", "high"]).optional(),
        priceSensitivity: z.enum(["low", "medium", "high"]).optional(),
        sentiment: z.enum(["negative", "neutral", "positive"]).optional(),
        objection: z.string().optional(),
      })
      .strict(),
    safety: z
      .object({
        optOut: z.boolean().optional(),
        requestsHuman: z.boolean().optional(),
        emergency: z.boolean().optional(),
      })
      .strict(),
    ambiguity: z
      .object({
        kind: z.string().min(1),
        candidates: z.array(z.string()).min(2),
      })
      .strict()
      .nullable(),
    notes: z.string().optional(),
  })
  .strict();

export type UnderstandingLabel = z.infer<typeof understandingSchema>;

const corpusCaseSchema = z
  .object({
    schemaVersion: z.literal(CORPUS_CASE_VERSION),
    caseId: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]*-\d{4}$/,
        "caseId must look like <journey>-<4 digits>",
      ),
    journey: z.enum(CORPUS_JOURNEYS),
    source: z
      .object({
        kind: z.enum(["historical", "curated_demo", "synthetic_regression"]),
        // Hash opaco do tenant e da conversa. Nunca o id real: o corpus não
        // pode ser a ponte de volta para a pessoa.
        tenantHash: z.string().regex(/^[0-9a-f]{8,64}$/),
        conversationHash: z.string().regex(/^[0-9a-f]{8,64}$/),
        turnIndex: z.number().int().min(0),
        capturedAt: z.string().datetime(),
      })
      .strict(),
    input: z
      .object({
        leadMessage: z.string(),
        history: z
          .array(
            z
              .object({
                author: z.enum(["lead", "agent", "operator"]),
                body: z.string(),
              })
              .strict(),
          )
          .max(40),
        state: z.string().nullable(),
        // Aponta para uma fixture de config sanitizada em
        // evals/corpus/tenant-configs/. Nunca para o tenant real.
        tenantConfigRef: z.string().min(1),
      })
      .strict(),
    observed: z
      .object({
        // Hipótese, nunca verdade: é o que a V1 respondeu, e é justamente o que
        // está sob julgamento.
        aiResponse: z.string().nullable(),
        // Candidata, nunca verdade automática: resposta humana ruim existe, e o
        // checklist é o que decide.
        humanResponse: z.string().nullable(),
      })
      .strict(),
    labels: z
      .object({
        understanding: understandingSchema,
        expectedActionResult: z
          .object({ type: z.string().min(1) })
          .passthrough(),
        prose: z
          .object({
            ai: proseAssessmentSchema.nullable(),
            human: proseAssessmentSchema.nullable(),
          })
          .strict(),
        betterResponder: z.enum(["ai", "human", "tie", "not_applicable"]),
      })
      .strict()
      .superRefine((labels, ctx) => {
        const derived = deriveBetterResponder(
          labels.prose.ai?.label ?? null,
          labels.prose.human?.label ?? null,
        );
        if (derived !== labels.betterResponder) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["betterResponder"],
            message: `betterResponder must be derived from the prose labels: expected ${derived}, got ${labels.betterResponder}`,
          });
        }
      }),
    provenance: z
      .object({
        reviewer: z.string().min(1),
        reviewedAt: z.string().datetime(),
        // Preenchido quando o caso passou pela dupla revisão de calibração.
        secondReviewer: z.string().min(1).optional(),
        secondReviewedAt: z.string().datetime().optional(),
      })
      .strict(),
    tags: z.array(z.string().regex(/^[a-z][a-z0-9:_-]*$/)),
  })
  .strict()
  .superRefine((corpusCase, ctx) => {
    if (!corpusCase.caseId.startsWith(`${corpusCase.journey}-`)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseId"],
        message: `caseId must start with its journey (${corpusCase.journey})`,
      });
    }
  });

export type CorpusCase = z.infer<typeof corpusCaseSchema>;

/**
 * Detectores de PII aplicados ao texto que entra no repositório. É a mesma
 * família usada pelo exportador de replay, com telefone acrescentado — o caso
 * rotulado carrega frase de lead, e é ali que número de WhatsApp aparece.
 */
const CORPUS_PII_DETECTORS: Readonly<Record<string, RegExp>> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  cnpj: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
  cep: /\b\d{5}-\d{3}\b/g,
  url: /https?:\/\/[^\s)"'<>]+/gi,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  phone: /(?:\+\s?55\s?)?(?:\(\s?\d{2}\s?\)|\b\d{2})\s?9?\s?\d{4}[\s-]?\d{4}\b/g,
  landline: /\b\d{4}-\d{4}\b/g,
};

function assertNoSurvivingPii(corpusCase: CorpusCase): void {
  const texts = [
    corpusCase.input.leadMessage,
    ...corpusCase.input.history.map((entry) => entry.body),
    corpusCase.observed.aiResponse ?? "",
    corpusCase.observed.humanResponse ?? "",
  ].join("\n");

  for (const [kind, detector] of Object.entries(CORPUS_PII_DETECTORS)) {
    detector.lastIndex = 0;
    if (detector.test(texts)) {
      throw new Error(
        `corpus case ${corpusCase.caseId} retained PII of kind "${kind}"`,
      );
    }
  }
}

/**
 * Migrações declaradas de versões antigas para a corrente.
 *
 * Vazio na v1 de propósito: o ponto é que a porta exista antes de ser
 * necessária. Quando a v2 chegar, um caso v1 é migrado aqui — explicitamente —
 * em vez de ser lido com campos faltando.
 */
export const CORPUS_CASE_MIGRATIONS: Readonly<
  Record<string, (raw: Record<string, unknown>) => Record<string, unknown>>
> = {};

export function parseCorpusCase(raw: unknown): CorpusCase {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("corpus case must be an object");
  }
  const record = raw as Record<string, unknown>;
  const version = record.schemaVersion;
  if (version !== CORPUS_CASE_VERSION) {
    const migrate =
      typeof version === "string"
        ? CORPUS_CASE_MIGRATIONS[version]
        : undefined;
    if (!migrate) {
      throw new Error(
        `unknown corpus case schemaVersion "${String(version)}" — expected ${CORPUS_CASE_VERSION}`,
      );
    }
    return parseCorpusCase(migrate(record));
  }

  const result = corpusCaseSchema.safeParse(record);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid corpus case: ${detail}`);
  }

  assertNoSurvivingPii(result.data);
  return result.data;
}
