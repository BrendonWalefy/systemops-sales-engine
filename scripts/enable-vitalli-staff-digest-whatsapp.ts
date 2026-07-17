#!/usr/bin/env tsx
/**
 * Habilita staffDigestWhatsAppEnabled SÓ para a Vitalli — opt-in explícito
 * (pedido do Victor, reunião 17/07/2026): o resumo diário do staff (agenda de
 * amanhã + pendentes de confirmação) passa a ser espelhado no WhatsApp pessoal
 * do doutor (receptionist_phone), além do push. Outras clínicas com
 * receptionist_phone configurado (ex.: NC Beauty) NÃO recebem o digest até
 * pedirem — o campo receptionist_phone sozinho só cobre avisos event-driven.
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com --apply.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-staff-digest-whatsapp.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-staff-digest-whatsapp.ts --apply
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");

async function main() {
  const [current] = await db
    .select({
      name: organizations.name,
      receptionistPhone: organizations.receptionistPhone,
      staffDigestWhatsAppEnabled: organizations.staffDigestWhatsAppEnabled,
    })
    .from(organizations)
    .where(eq(organizations.id, VITALLI_ID))
    .limit(1);
  if (!current) throw new Error("Vitalli não encontrada.");

  console.log(
    `Clínica: ${current.name} — receptionist_phone: ${current.receptionistPhone ?? "—"} — ` +
      `staffDigestWhatsAppEnabled atual: ${current.staffDigestWhatsAppEnabled}`,
  );

  if (!current.receptionistPhone) {
    console.warn(
      "⚠️  receptionist_phone vazio — o digest não terá para onde ir até o telefone ser configurado.",
    );
  }

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db
    .update(organizations)
    .set({ staffDigestWhatsAppEnabled: true, updatedAt: new Date() })
    .where(eq(organizations.id, VITALLI_ID));

  console.log("✅ staffDigestWhatsAppEnabled=true para a Vitalli.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
