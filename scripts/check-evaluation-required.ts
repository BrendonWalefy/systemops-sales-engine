/**
 * Verifica o status de requiresEvaluationFirst para todos os tratamentos.
 * Run: npx dotenv -e .env.local -- npx tsx scripts/check-evaluation-required.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { treatments, organizations } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

async function main() {
  const rows = await db
    .select({
      clinicName: organizations.name,
      treatmentName: treatments.name,
      requiresEvaluationFirst: treatments.requiresEvaluationFirst,
      durationMinutes: treatments.durationMinutes,
    })
    .from(treatments)
    .innerJoin(organizations, eq(treatments.clinicId, organizations.id))
    .orderBy(organizations.name, treatments.name);

  if (rows.length === 0) {
    console.log("Nenhum tratamento encontrado.");
    await sql.end();
    return;
  }

  let currentClinic = "";
  for (const row of rows) {
    if (row.clinicName !== currentClinic) {
      currentClinic = row.clinicName;
      console.log(`\n📋 ${currentClinic}`);
      console.log("─".repeat(60));
    }
    const flag = row.requiresEvaluationFirst ? "✅ requer avaliação" : "  agendamento direto";
    console.log(`  ${flag}  |  ${row.durationMinutes}min  |  ${row.treatmentName}`);
  }

  console.log("");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
