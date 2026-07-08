/**
 * Script: set-vitalli-debounce.ts
 * Define messageDebounceMs = 7000 para a Clínica Vitalli.
 * Janela maior (7 s) cobre o padrão de usuários que enviam múltiplas bolhas
 * de mensagens em sequência (ex: "Boa noite" + contexto longo + pergunta).
 *
 * Usage: npx tsx scripts/set-vitalli-debounce.ts
 */

import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";
import { like } from "drizzle-orm";

async function main() {
  const rows = await db
    .update(organizations)
    .set({ messageDebounceMs: 7000 })
    .where(like(organizations.name, "%italli%"))
    .returning({ id: organizations.id, name: organizations.name, debounceMs: organizations.messageDebounceMs });

  if (rows.length === 0) {
    console.error("❌ Nenhuma clínica encontrada com nome contendo 'italli'.");
    process.exit(1);
  }

  for (const row of rows) {
    console.log(`✅ ${row.name} (${row.id}) → messageDebounceMs = ${row.debounceMs}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
