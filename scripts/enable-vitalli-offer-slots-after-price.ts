#!/usr/bin/env tsx
/**
 * Habilita offerSlotsAfterPriceEnabled SÓ para a Vitalli — opt-in explícito
 * (pedido do Victor, reunião 17/07/2026). Outras clínicas concierge (ex.:
 * Ximendes) ficam com o comportamento atual até serem validadas.
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com --apply.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-offer-slots-after-price.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/enable-vitalli-offer-slots-after-price.ts --apply
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");

async function main() {
  const [current] = await db
    .select({ name: organizations.name, offerSlotsAfterPriceEnabled: organizations.offerSlotsAfterPriceEnabled })
    .from(organizations)
    .where(eq(organizations.id, VITALLI_ID))
    .limit(1);
  if (!current) throw new Error("Vitalli não encontrada.");

  console.log(`Clínica: ${current.name} — offerSlotsAfterPriceEnabled atual: ${current.offerSlotsAfterPriceEnabled}`);

  if (!APPLY) {
    console.log("\nℹ️  Dry-run — nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db
    .update(organizations)
    .set({ offerSlotsAfterPriceEnabled: true, updatedAt: new Date() })
    .where(eq(organizations.id, VITALLI_ID));

  console.log("✅ offerSlotsAfterPriceEnabled=true para a Vitalli.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
