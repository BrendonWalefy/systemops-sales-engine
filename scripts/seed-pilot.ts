/**
 * Seed the pilot clinic (Ximendes Odontologia) and print the clinic ID.
 * Run: npx tsx scripts/seed-pilot.ts
 * Requires DATABASE_URL in environment (or .env.local).
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import { clinics, treatments } from "../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

async function main() {
  const existing = await db
    .select()
    .from(clinics)
    .where(eq(clinics.name, "Ximendes Odontologia"))
    .limit(1);

  if (existing.length > 0) {
    const clinic = existing[0];
    console.log("✅ Clinic already exists:");
    console.log(`   Name: ${clinic.name}`);
    console.log(`   ID:   ${clinic.id}`);
    console.log(`\nAdd to .env.local and Vercel:`);
    console.log(`PILOT_CLINIC_ID=${clinic.id}`);
    await sql.end();
    return;
  }

  const clinicId = randomUUID();
  const now = new Date();

  await db.insert(clinics).values({
    id: clinicId,
    name: "Ximendes Odontologia",
    specialty: "odontologia",
    city: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(treatments).values([
    {
      id: randomUUID(),
      clinicId,
      name: "Avaliação gratuita",
      description: "Consulta inicial gratuita com o Dr. Ximendes para diagnóstico e orientação.",
      commonObjections: ["Não tenho tempo", "Fica longe", "Vou pensar"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Implante dentário",
      description: "Implante de titânio para substituição de dente perdido.",
      commonObjections: ["Muito caro", "Dói?", "Quanto tempo leva?"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Alinhadores invisíveis",
      description: "Correção ortodôntica com alinhadores transparentes removíveis.",
      commonObjections: ["Quanto custa?", "Quanto tempo demora?", "É melhor que aparelho fixo?"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Harmonização orofacial",
      description: "Procedimentos estéticos faciais realizados pelo dentista.",
      commonObjections: ["É seguro?", "Quanto dura o resultado?", "Quanto custa?"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Clareamento dental",
      description: "Clareamento a laser ou com moldeiras para uso em casa.",
      commonObjections: ["Vai sensibilizar?", "Quanto dura?", "Quanto custa?"],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log("✅ Clinic created:");
  console.log(`   Name: Ximendes Odontologia`);
  console.log(`   ID:   ${clinicId}`);
  console.log(`\nAdd to .env.local and Vercel:`);
  console.log(`PILOT_CLINIC_ID=${clinicId}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
