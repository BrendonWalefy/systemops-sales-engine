/**
 * Motor de Reativação (ADR-009), Fase 1 — caso de uso.
 *
 * Descobre por que cada lead não fechou, lendo a conversa. **Não envia nada.**
 * O resultado alimenta a segmentação de campanhas (Fase 2) e o relatório que a
 * clínica lê ("por que meus pacientes não fecharam").
 *
 * Três invariantes que valem mais que a taxa de classificação:
 *  1. Correção humana é soberana — `source = 'human'` nunca é sobrescrito.
 *  2. Conversa que não mudou não é reclassificada — evita queimar LLM à toa.
 *  3. Estourou o orçamento do dia, para. Não há fila em memória a perder: a
 *     elegibilidade é recalculada do banco na execução seguinte.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { leadOutcomes, organizations } from "@/infrastructure/db/schema";
import {
  buildLeadOutcomePrompt,
  parseLeadOutcomeResponse,
  MAX_CLASSIFIER_MESSAGES,
  type ClassifierMessage,
} from "@/core/intelligence/LeadOutcomeClassifier";
import {
  callAdvisorLLMWithUsage,
  REACTIVATION_MODEL,
} from "@/infrastructure/llm/advisor-llm";
import { DefaultUsageCostTracker } from "@/application/services/default-usage-cost-tracker";
import { DrizzleUsageCostRepository } from "@/infrastructure/repositories/drizzle-usage-cost-repository";
import { trackUsageSafely } from "@/application/reactivation/track-usage-safely";
import { estimateAiCostUsdMicros } from "@/application/services/cost-estimator";
import {
  evaluateBudget,
  getReactivationSpendToday,
  resolveDailyBudgetUsdMicros,
} from "@/application/reactivation/cost-guard";
import { randomUUID } from "crypto";

/**
 * Só classificamos conversas paradas há pelo menos 48h. Conversa viva não
 * "deixou de fechar" — ainda está acontecendo, e rotular agora produziria um
 * motivo errado que a campanha depois usaria.
 */
const MIN_IDLE_HOURS = 48;

/** Teto de leads por execução, por clínica — o cron roda diário e recupera o resto. */
const MAX_LEADS_PER_RUN = 40;

const MAX_OUTPUT_TOKENS = 300;

type EligibleLead = {
  lead_id: string;
  conv_id: string;
  name: string | null;
  treatment_interest: string | null;
  last_message_id: string;
};

export type ClassifyResult = {
  clinicId: string;
  classified: number;
  skipped: number;
  failed: number;
  budgetExhausted: boolean;
  spentUsdMicros: number;
};

/**
 * Leads elegíveis: não fecharam, a conversa esfriou, e ou nunca foram
 * classificados ou a conversa mudou desde a última classificação.
 */
async function findEligibleLeads(clinicId: string): Promise<EligibleLead[]> {
  const result = await db.execute(sql`
    WITH ultima_msg AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.id   AS last_message_id,
        m.sent_at
      FROM messages m
      ORDER BY m.conversation_id, m.sent_at DESC
    )
    SELECT
      l.id                  AS lead_id,
      c.id                  AS conv_id,
      l.name,
      l.treatment_interest,
      u.last_message_id
    FROM leads l
    JOIN conversations c ON c.lead_id = l.id
    JOIN ultima_msg    u ON u.conversation_id = c.id
    LEFT JOIN lead_outcomes o
      ON o.lead_id = l.id AND o.organization_id = ${clinicId}
    WHERE l.organization_id = ${clinicId}
      AND c.category = 'sales'
      AND l.status NOT IN ('won', 'appointment_scheduled')
      -- make_interval em vez de concatenar texto: com parâmetro vinculado, o
      -- Postgres não consegue inferir o tipo em ("$1" || ' hours')::interval e
      -- a query falha em runtime. Aqui o argumento nomeado já é integer.
      AND c.last_message_at < NOW() - make_interval(hours => ${MIN_IDLE_HOURS})
      -- Precisa existir fala do lead: sem isso não há o que interpretar.
      AND EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.conversation_id = c.id AND m2.author = 'lead'
      )
      -- Classificação humana é soberana: nunca reprocessar.
      AND (o.id IS NULL OR o.source <> 'human')
      -- Reclassifica só se a conversa andou desde a última leitura.
      AND (o.id IS NULL OR o.last_seen_message_id IS DISTINCT FROM u.last_message_id)
    ORDER BY c.last_message_at DESC
    LIMIT ${MAX_LEADS_PER_RUN}
  `);

  return result.rows as EligibleLead[];
}

async function loadConversationMessages(
  conversationId: string,
): Promise<ClassifierMessage[]> {
  const result = await db.execute(sql`
    SELECT id, author, body
    FROM messages
    WHERE conversation_id = ${conversationId}
      AND author IN ('lead', 'agent', 'clinic_user')
    ORDER BY sent_at DESC
    LIMIT ${MAX_CLASSIFIER_MESSAGES}
  `);

  return (result.rows as ClassifierMessage[]).reverse();
}

/**
 * Grava o resultado. O `where` no conflito é o que garante a invariante 1:
 * o UPDATE não acontece quando a linha existente foi corrigida por humano.
 */
async function persistOutcome(input: {
  clinicId: string;
  leadId: string;
  conversationId: string;
  reason: string;
  evidenceExcerpt: string | null;
  evidenceMessageId: string | null;
  confidence: number;
  model: string;
  lastSeenMessageId: string;
}): Promise<void> {
  const now = new Date();
  const values = {
    id: randomUUID(),
    clinicId: input.clinicId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    reason: input.reason as typeof leadOutcomes.$inferInsert.reason,
    evidenceExcerpt: input.evidenceExcerpt,
    evidenceMessageId: input.evidenceMessageId,
    confidence: input.confidence,
    source: "llm" as const,
    model: input.model,
    lastSeenMessageId: input.lastSeenMessageId,
    classifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(leadOutcomes)
    .values(values)
    .onConflictDoUpdate({
      target: [leadOutcomes.clinicId, leadOutcomes.leadId],
      set: {
        conversationId: values.conversationId,
        reason: values.reason,
        evidenceExcerpt: values.evidenceExcerpt,
        evidenceMessageId: values.evidenceMessageId,
        confidence: values.confidence,
        source: values.source,
        model: values.model,
        lastSeenMessageId: values.lastSeenMessageId,
        classifiedAt: now,
        updatedAt: now,
      },
      where: sql`${leadOutcomes.source} <> 'human'`,
    });
}

export async function classifyLeadOutcomesForClinic(
  clinicId: string,
): Promise<ClassifyResult> {
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
  });

  const empty: ClassifyResult = {
    clinicId,
    classified: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    spentUsdMicros: 0,
  };

  if (!clinic) return empty;

  const budget = resolveDailyBudgetUsdMicros();
  let spent = await getReactivationSpendToday(clinicId, clinic.timezone);

  if (!evaluateBudget(spent, budget).allowed) {
    console.log(
      `[LeadOutcome] orçamento do dia esgotado clinic=${clinicId} gasto=${spent} teto=${budget}`,
    );
    return { ...empty, budgetExhausted: true, spentUsdMicros: spent };
  }

  const leads = await findEligibleLeads(clinicId);
  console.log(`[LeadOutcome] clinic=${clinicId} elegíveis=${leads.length}`);

  const costTracker = new DefaultUsageCostTracker({
    usageCostRepository: new DrizzleUsageCostRepository(),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  });

  let classified = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of leads) {
    if (!evaluateBudget(spent, budget).allowed) {
      console.log(
        `[LeadOutcome] parando por orçamento clinic=${clinicId} gasto=${spent} teto=${budget}`,
      );
      return {
        clinicId,
        classified,
        skipped,
        failed,
        budgetExhausted: true,
        spentUsdMicros: spent,
      };
    }

    try {
      const messages = await loadConversationMessages(lead.conv_id);
      if (messages.length === 0) {
        skipped++;
        continue;
      }

      const prompt = buildLeadOutcomePrompt({
        clinicName: clinic.name,
        specialty: clinic.specialty ?? "odontologia estética",
        leadName: lead.name,
        treatmentInterest: lead.treatment_interest,
        messages,
      });

      const llm = await callAdvisorLLMWithUsage(prompt, {
        model: REACTIVATION_MODEL,
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const usage = {
        clinicId,
        provider: llm.provider,
        model: llm.model,
        operation: "lead_outcome_classification" as const,
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
      };
      // Acumula o gasto antes de registrar: o teto vale mesmo se o INSERT de
      // contabilidade falhar, e a falha nunca descarta a classificação paga.
      spent += estimateAiCostUsdMicros(usage);
      await trackUsageSafely(costTracker, usage);

      const classification = parseLeadOutcomeResponse(llm.text, messages);
      if (!classification) {
        // Resposta inaproveitável. Gravar um motivo inventado seria pior que
        // não gravar: a clínica dispararia oferta com base em ficção.
        console.warn(`[LeadOutcome] resposta inválida lead=${lead.lead_id}`);
        failed++;
        continue;
      }

      await persistOutcome({
        clinicId,
        leadId: lead.lead_id,
        conversationId: lead.conv_id,
        reason: classification.reason,
        evidenceExcerpt: classification.evidenceExcerpt,
        evidenceMessageId: classification.evidenceMessageId,
        confidence: classification.confidence,
        model: llm.model,
        lastSeenMessageId: lead.last_message_id,
      });

      classified++;
    } catch (err: unknown) {
      console.error(
        `[LeadOutcome] erro lead=${lead.lead_id}:`,
        err instanceof Error ? err.message : String(err),
      );
      failed++;
    }
  }

  return {
    clinicId,
    classified,
    skipped,
    failed,
    budgetExhausted: false,
    spentUsdMicros: spent,
  };
}
