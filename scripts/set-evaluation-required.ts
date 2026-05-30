/**
 * Marca tratamentos complexos como requiresEvaluationFirst = true.
 * Run: npx dotenv -e .env.local -- npx tsx scripts/set-evaluation-required.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { treatments } from "../src/infrastructure/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const CLINIC_ID = "c9137774-e783-4461-ac2b-e2f01be739a6";

const COMPLEX_TREATMENTS = [
  "20 Lentes",
  "Manutenção das lentes",
  "Implante dentário",
  "Alinhadores invisíveis",
  "Harmonização orofacial",
];

async function main() {
  const updated = await db
    .update(treatments)
    .set({ requiresEvaluationFirst: true, updatedAt: new Date() })
    .where(
      and(
        eq(treatments.clinicId, CLINIC_ID),
        inArray(treatments.name, COMPLEX_TREATMENTS),
      ),
    )
    .returning({ name: treatments.name });

  if (updated.length === 0) {
    console.log("⚠️  Nenhum tratamento encontrado com esses nomes. Verifique os nomes exatos no banco.");
  } else {
    console.log(`✅ ${updated.length} tratamento(s) marcado(s) como requiresEvaluationFirst:`);
    updated.forEach((t) => console.log(`   • ${t.name}`));
  }

  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
