#!/usr/bin/env tsx
/**
 * Nova versão de playbook da Vitalli alinhada à derivação de preço (PR #172).
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com `--apply`.
 *
 * O quê: clona a versão ativa, reescreve a commercialPolicy REMOVENDO os preços em R$
 * (agora derivados de treatments.quantityPrices/priceCents via composePriceSection —
 * a ativação inclusive BLOQUEIA preço em R$ na política) e a circularidade "informado
 * acima", e ADICIONA a objeção de "preço antigo". Depois ativa (as demais viram historical).
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-playbook-v3.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-playbook-v3.ts --apply
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { organizations, playbookVersions, treatments } from "../src/infrastructure/db/schema";
import { and, eq, ne } from "drizzle-orm";
import {
  publishablePlaybookSchema,
  blockingPlaybookNotesIssues,
  blockingCommercialPolicyIssues,
  blockingTreatmentDescriptionIssues,
} from "../src/application/config/editorial-config";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");
const NEW_NAME = "Clínica Vitalli — Promocional v3 (config IA jul/2026)";

// Política comercial SEM preços em R$ (derivados agora) e sem a circularidade
// "informado acima". Só enquadramento — os números saem de composePriceSection.
const NEW_COMMERCIAL_POLICY = `Éramos Dental Luxe, hoje somos Clínica Vitalli. Antes ficávamos no bairro Sabará, próximo a Interlagos; hoje estamos na Avenida Adolfo Pinheiro, em Santo Amaro.

Trabalhamos com duas técnicas de lentes em resina e estamos com preços promocionais por tempo limitado. A Técnica Simplificada usa uma resina de alta qualidade para um sorriso harmônico e natural, com um investimento mais acessível. A Técnica Estratificada combina duas resinas com bordas translúcidas, para máxima naturalidade e o resultado mais sofisticado. Nossos pacotes fechados são de 10 ou 20 lentes.

Trabalhamos com opções bem flexíveis de pagamento, podendo parcelar em até 21 vezes no cartão, com a opção de fazer em até 3 vezes sem juros.

Caso você já possua lentes antigas e precise fazer a troca, também realizamos remoção, prótese adesiva e limpeza. Nossa manutenção preventiva periódica já inclui profilaxia, polimento e nova aplicação da película protetora, que mantém o brilho e a limpeza dos dentes.

Para reservar a agenda e garantir o seu horário com o Doutor — que é muito concorrido — cobramos um sinal para confirmar a avaliação. Esse sinal é integralmente abatido no dia do procedimento e não é reembolsável caso o paciente não compareça. O pagamento é feito via Pix no CNPJ 54.659.849/0001-09 em nome de Dr. Victor Cavalcante.`;

const OLD_PRICE_OBJECTION = {
  objection: "Vocês me passaram um valor menor antes / era mais barato antes",
  response:
    "Que bom que você lembra do nosso contato! Aquele valor era de uma promoção com prazo que já passou. O valor atual é o vigente e seguimos com condições bem flexíveis de parcelamento. Posso te mostrar os horários para a avaliação com o Doutor?",
};

function compileToClinicFields(data: {
  specialty: string | null;
  toneOfVoice: string | null;
  differentials: string[] | null;
  commercialPolicy: string | null;
  objections: { objection: string; response: string }[] | null;
}) {
  const parts: string[] = [];
  if (data.specialty) parts.push(`ESPECIALIDADE: ${data.specialty}`);
  if (data.differentials?.length) parts.push(`\nDIFERENCIAIS DO NEGÓCIO:\n${data.differentials.map((d) => `- ${d}`).join("\n")}`);
  if (data.objections?.length) {
    const objText = data.objections.map((o) => `Objeção: ${o.objection}\nResposta: ${o.response}`).join("\n\n");
    parts.push(`\nOBJEÇÕES E RESPOSTAS:\n${objText}`);
  }
  const toneMap: Record<string, string> = {
    acolhedor: "Acolhedor e empático", tecnico: "Técnico e informativo",
    persuasivo: "Persuasivo e orientado a resultados", luxo: "Premium e exclusivo",
  };
  return {
    playbook: parts.join("\n") || null,
    commercialPolicy: data.commercialPolicy || null,
    toneOfVoice: toneMap[data.toneOfVoice ?? "acolhedor"] ?? data.toneOfVoice ?? null,
  };
}

async function main() {
  console.log(`\n=== Novo playbook Vitalli — ${APPLY ? "APLICANDO" : "DRY-RUN (use --apply)"} ===\n`);

  const [active] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, VITALLI_ID), eq(playbookVersions.status, "active")))
    .limit(1);
  if (!active) throw new Error("Nenhuma versão ativa encontrada para clonar.");
  console.log(`Clonando de: "${active.name}" (receptionist=${active.receptionistName})`);

  const existingObjections = (active.objections as { objection: string; response: string }[] | null) ?? [];
  const alreadyHasOldPrice = existingObjections.some((o) => /passaram|antes|promocao (antiga|passada)/i.test(o.objection));
  const newObjections = alreadyHasOldPrice ? existingObjections : [...existingObjections, OLD_PRICE_OBJECTION];

  // ── Gates de validação (mesmos da ativação pelo painel) ──
  const validation = publishablePlaybookSchema.safeParse({
    specialty: active.specialty ?? "",
    toneOfVoice: active.toneOfVoice ?? "acolhedor",
    receptionistName: active.receptionistName,
    differentials: active.differentials ?? [],
    commercialPolicy: NEW_COMMERCIAL_POLICY,
  });
  if (!validation.success) {
    throw new Error("Playbook inválido: " + validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const policyIssues = blockingCommercialPolicyIssues(NEW_COMMERCIAL_POLICY);
  if (policyIssues.length) throw new Error("commercialPolicy bloqueada: " + policyIssues.join("; "));
  const notesIssues = blockingPlaybookNotesIssues(active.notes);
  if (notesIssues.length) throw new Error("notes bloqueadas: " + notesIssues.join("; "));
  const clinicTreatments = await db
    .select({ name: treatments.name, description: treatments.description })
    .from(treatments)
    .where(eq(treatments.clinicId, VITALLI_ID));
  const descIssues = blockingTreatmentDescriptionIssues(clinicTreatments);
  if (descIssues.length) throw new Error("descrições de tratamento bloqueadas: " + descIssues.join("; "));

  console.log("\n✓ Gates de validação OK (sem preço em R$ na política, notes/descrições limpas).");
  console.log(`\n--- Nova commercialPolicy (sem preços; derivados de composePriceSection) ---\n${NEW_COMMERCIAL_POLICY}\n`);
  console.log(`--- Objeções (${newObjections.length}) — nova adicionada: "${OLD_PRICE_OBJECTION.objection}" ---`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply para criar e ativar.\n");
    process.exit(0);
  }

  // ── Cria a nova versão (clone) já como active; demais viram historical ──
  const [created] = await db
    .insert(playbookVersions)
    .values({
      clinicId: VITALLI_ID,
      name: NEW_NAME,
      status: "draft",
      specialty: active.specialty,
      toneOfVoice: active.toneOfVoice,
      receptionistName: active.receptionistName,
      differentials: active.differentials,
      commercialPolicy: NEW_COMMERCIAL_POLICY,
      objections: newObjections,
      notes: active.notes,
      mediaAssetIds: active.mediaAssetIds,
      mediaLibrary: active.mediaLibrary,
    })
    .returning({ id: playbookVersions.id });

  await db
    .update(playbookVersions)
    .set({ status: "historical", updatedAt: new Date() })
    .where(and(eq(playbookVersions.clinicId, VITALLI_ID), ne(playbookVersions.id, created.id), ne(playbookVersions.status, "draft")));

  await db
    .update(playbookVersions)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(playbookVersions.id, created.id));

  const clinicFields = compileToClinicFields({
    specialty: active.specialty,
    toneOfVoice: active.toneOfVoice,
    differentials: active.differentials as string[] | null,
    commercialPolicy: NEW_COMMERCIAL_POLICY,
    objections: newObjections,
  });
  await db.update(organizations).set({ ...clinicFields, updatedAt: new Date() }).where(eq(organizations.id, VITALLI_ID));

  console.log(`\n✅ Nova versão "${NEW_NAME}" criada e ATIVADA (${created.id}). Anteriores → historical.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
