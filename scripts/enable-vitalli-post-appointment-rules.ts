#!/usr/bin/env tsx
/**
 * Régua de pós-atendimento da Vitalli (pedido do Victor, reunião 17/07/2026):
 *   1. Cuidados 1h após o fim da consulta de lentes (dispara por relógio; pula
 *      cancelado/no-show). Envia a intro + a imagem de cuidados.
 *   2. Pedido de feedback 24h após — só se a consulta foi marcada como
 *      "concluída" (requiresStatus: completed); a resposta cai na conversa normal.
 *
 * Config por clínica (organizations.postAppointmentRules). O cron
 * post-appointment-followup percorre as regras de todas as clínicas; sem regras,
 * nada dispara. Na Vitalli em shadow mode nada é enviado de verdade até ir live.
 *
 * ⚠️ Cap de mídia: o guia completo de cuidados (2ª imagem) e o vídeo 10MB ainda
 * NÃO estão na biblioteca (Vitalli no cap de 10). Quando entrarem, é só somar os
 * ids em cuidados.mediaIds e rodar de novo.
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com --apply.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-post-appointment-rules.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-post-appointment-rules.ts --apply
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";
import type { PostAppointmentRule } from "../src/domain/entities/post-appointment-rule";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const LENTES_TREATMENT_ID = "39b29140-f356-4a0c-aa36-be533aa58c8e";
const CUIDADOS_MEDIA_ID = "7e620435-40bc-46ba-8051-9d52732ec525"; // "Cuidados Pós Lentes"
const APPLY = process.argv.includes("--apply");

const RULES: PostAppointmentRule[] = [
  {
    id: "cuidados-lentes",
    label: "Cuidados pós-lentes (1h)",
    offsetHours: 1,
    anchor: "appointment_end",
    treatmentIds: [LENTES_TREATMENT_ID],
    message:
      "Oi {nome}! Tudo certo? 😊 Seu procedimento de lentes em resina foi concluído — seguem os cuidados para as próximas horas garantirem o melhor resultado do seu novo sorriso 🦷✨",
    mediaIds: [CUIDADOS_MEDIA_ID],
    // Transacional (dever de cuidado) — sempre entregue, sem gate de opt-out.
    category: "operational",
  },
  {
    id: "feedback-lentes",
    label: "Pedido de feedback (24h)",
    offsetHours: 24,
    anchor: "appointment_end",
    // Só pede opinião de quem realmente foi atendido.
    requiresStatus: "completed",
    treatmentIds: [LENTES_TREATMENT_ID],
    message:
      "Olá {nome}, tudo bem? 😊 Passando para saber como foi seu atendimento aqui na clínica e o que você achou do resultado das suas lentes em resina ✨🦷 Sua opinião é muito importante para nós!",
    // Outreach opcional — respeita opt-out/quiet hours.
    category: "follow_up",
  },
];

async function main() {
  const [current] = await db
    .select({ name: organizations.name, rules: organizations.postAppointmentRules })
    .from(organizations)
    .where(eq(organizations.id, VITALLI_ID))
    .limit(1);
  if (!current) throw new Error("Vitalli não encontrada.");

  console.log(`Clínica: ${current.name}`);
  console.log(`Regras atuais: ${JSON.stringify(current.rules ?? [])}`);
  console.log(`Regras novas:  ${JSON.stringify(RULES, null, 2)}`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db
    .update(organizations)
    .set({ postAppointmentRules: RULES, updatedAt: new Date() })
    .where(eq(organizations.id, VITALLI_ID));

  console.log("\n✅ Régua de pós-atendimento aplicada na Vitalli (2 regras).");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
