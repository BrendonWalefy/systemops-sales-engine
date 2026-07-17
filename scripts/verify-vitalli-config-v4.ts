#!/usr/bin/env tsx
// Verificação READ-ONLY pós-aplicação do config v4: imprime o que a IA
// efetivamente recebe (editorial resolvido + seção de preços derivada + mídia).
import "dotenv/config";
import { resolveActiveEditorialConfig } from "../src/application/config/editorial-config";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";

async function main() {
  const editorial = await resolveActiveEditorialConfig(VITALLI_ID);
  if (!editorial) throw new Error("Editorial não resolvido");

  console.log("=== POLÍTICA COMERCIAL (como chega ao prompt) ===\n");
  console.log(editorial.commercialPolicy);

  console.log("\n=== PROCEDURES (nomes que a IA conhece) ===");
  for (const p of editorial.procedures ?? []) console.log(`- ${p.name}`);

  console.log("\n=== BIBLIOTECA DE MÍDIA AUTORIZADA ===");
  for (const m of editorial.mediaLibrary ?? []) {
    console.log(`- [${m.type}] "${m.title}" (treatment=${m.treatmentId ?? "GERAL"})`);
  }

  console.log("\n=== NOTES ===\n");
  console.log(editorial.playbookText ?? "(sem notes)");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
