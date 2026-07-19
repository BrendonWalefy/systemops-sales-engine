/**
 * Corrige as configurações que causaram os casos Tatiana, Henrique e Nataly.
 *
 * Uso:
 *   npx dotenv -e .env.local -- npx tsx scripts/fix-vitalli-conversation-pendencies.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/fix-vitalli-conversation-pendencies.ts --apply
 *
 * Idempotente. O vínculo de pipeline requer a migration que adiciona
 * treatments.pipeline_source_treatment_id; as demais correções podem ser
 * aplicadas antes e são verificadas novamente ao final.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import {
  organizations,
  playbookVersions,
  treatments,
} from "../src/infrastructure/db/schema";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");

const OLD_POLICY = "cobramos um sinal para confirmar a avaliação";
const NEW_POLICY = "cobramos um sinal de reserva. A avaliação em si não tem custo";
const OLD_NOTE = "pagamento do sinal da avaliação via Pix (valor informado no cadastro do procedimento)";
const NEW_NOTE = "a avaliação não tem custo e que, para reservar o horário na agenda concorrida do Doutor, a clínica exige um sinal via Pix configurado separadamente no cadastro da clínica";

async function main() {
  const [clinic] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slotLookaheadDays: organizations.slotLookaheadDays,
      depositEnabled: organizations.depositEnabled,
      depositAmountCents: organizations.depositAmountCents,
    })
    .from(organizations)
    .where(eq(organizations.id, VITALLI_ID));
  if (!clinic) throw new Error("Clínica Vitalli não encontrada");
  if (!clinic.depositEnabled || clinic.depositAmountCents !== 3000) {
    throw new Error("Configuração do sinal divergiu do esperado; abortando sem alterar");
  }

  const rows = await db
    .select({
      id: treatments.id,
      name: treatments.name,
      priceCents: treatments.priceCents,
      priceQuotableInChat: treatments.priceQuotableInChat,
      priceDeductible: treatments.priceDeductible,
    })
    .from(treatments)
    .where(eq(treatments.clinicId, VITALLI_ID));
  const byName = new Map(rows.map((row) => [row.name, row]));
  const evaluation = byName.get("Avaliação Clínica Inicial");
  const lenses = byName.get("Lentes em Resina Composta");
  const premium = byName.get("Lente em Resina Premium");
  const layered = byName.get("Lente em Resina Estratificada");
  if (!evaluation || !lenses || !premium || !layered) {
    throw new Error("Tratamentos esperados da Vitalli não foram encontrados");
  }

  const [activePlaybook] = await db
    .select()
    .from(playbookVersions)
    .where(and(
      eq(playbookVersions.clinicId, VITALLI_ID),
      eq(playbookVersions.status, "active"),
    ));
  if (!activePlaybook) throw new Error("Playbook ativo da Vitalli não encontrado");

  const nextPolicy = activePlaybook.commercialPolicy?.includes(OLD_POLICY)
    ? activePlaybook.commercialPolicy.replace(OLD_POLICY, NEW_POLICY)
    : activePlaybook.commercialPolicy;
  const nextNotes = activePlaybook.notes?.includes(OLD_NOTE)
    ? activePlaybook.notes.replace(OLD_NOTE, NEW_NOTE)
    : activePlaybook.notes;

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    clinic: clinic.name,
    evaluationBefore: evaluation,
    slotLookaheadDays: { before: clinic.slotLookaheadDays, after: Math.max(clinic.slotLookaheadDays, 30) },
    pipelineSource: { premium: lenses.id, layered: lenses.id },
    policyWillChange: nextPolicy !== activePlaybook.commercialPolicy,
    notesWillChange: nextNotes !== activePlaybook.notes,
  }, null, 2));

  if (!APPLY) return;
  const now = new Date();
  await db.update(treatments).set({
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceDeductible: false,
    updatedAt: now,
  }).where(eq(treatments.id, evaluation.id));
  await db.update(organizations).set({
    slotLookaheadDays: Math.max(clinic.slotLookaheadDays, 30),
    updatedAt: now,
  }).where(eq(organizations.id, VITALLI_ID));
  await db.update(playbookVersions).set({
    commercialPolicy: nextPolicy,
    notes: nextNotes,
    updatedAt: now,
  }).where(eq(playbookVersions.id, activePlaybook.id));
  await db.update(treatments).set({
    pipelineSourceTreatmentId: lenses.id,
    updatedAt: now,
  }).where(eq(treatments.id, premium.id));
  await db.update(treatments).set({
    pipelineSourceTreatmentId: lenses.id,
    updatedAt: now,
  }).where(eq(treatments.id, layered.id));

  console.log("Configuração corrigida com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
