/**
 * Seed the Ximendes clinic and print the clinic ID.
 * Run: npx tsx scripts/seed-ximendes.ts
 * Requires DATABASE_URL in environment (or .env.local).
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "crypto";
import { organizations, treatments } from "../src/infrastructure/db/schema";
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
    .from(organizations)
    .where(eq(organizations.name, "Ximendes Odontologia"))
    .limit(1);

  if (existing.length > 0) {
    const clinic = existing[0];
    if (clinic.calendarMode !== "internal") {
      await db.update(organizations).set({ calendarMode: "internal" }).where(eq(organizations.id, clinic.id));
      console.log("   → calendarMode atualizado para 'internal'");
    }
    console.log("✅ Clinic already exists:");
    console.log(`   Name: ${clinic.name}`);
    console.log(`   ID:   ${clinic.id}`);
    console.log(`   Slug: ${clinic.slug ?? "(sem slug)"}`);
    await sql.end();
    return;
  }

  const clinicId = randomUUID();
  const now = new Date();

  await db.insert(organizations).values({
    id: clinicId,
    name: "Ximendes Odontologia",
    slug: "ximendes",
    specialty: "odontologia",
    city: null,
    calendarMode: "internal",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(treatments).values([
    {
      id: randomUUID(),
      clinicId,
      name: "Avaliação gratuita",
      description: "Consulta inicial gratuita com o Dr. Ximendes para diagnóstico e orientação.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Implante dentário",
      description: "Implante de titânio para substituição de dente perdido.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Alinhadores invisíveis",
      description: "Correção ortodôntica com alinhadores transparentes removíveis.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Harmonização orofacial",
      description: "Procedimentos estéticos faciais realizados pelo dentista.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      clinicId,
      name: "Clareamento dental",
      description: "Clareamento a laser ou com moldeiras para uso em casa.",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log("✅ Clinic created:");
  console.log(`   Name: Ximendes Odontologia`);
  console.log(`   Slug: ximendes`);
  console.log(`   ID:   ${clinicId}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
